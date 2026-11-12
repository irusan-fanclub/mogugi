package desktop

import (
	_ "embed"
	"html/template"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/irusan-fanclub/mogugi/internal/app"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"golang.org/x/sys/windows"
)

//go:embed otherInstance.html
var otherInstancePage string

// instanceSide is one mogugi exe as the dialog lists it; Path is "" when unreadable.
type instanceSide struct {
	Version string
	Path    string
}

// needsOtherInstanceDialog reports whether the running mogugi is another exe.
// The same exe falls through to the single-instance lock, which shows its window.
func needsOtherInstanceDialog(running, self instanceSide) bool {
	if running.Path == "" {
		return running.Version != self.Version
	}
	return !strings.EqualFold(filepath.Clean(running.Path), filepath.Clean(self.Path))
}

// exePathOf returns the image path of process pid, or "" when it cannot be read.
func exePathOf(pid int) string {
	h, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
	if err != nil {
		return ""
	}
	defer windows.CloseHandle(h)
	buf := make([]uint16, windows.MAX_LONG_PATH)
	n := uint32(len(buf))
	if windows.QueryFullProcessImageName(h, 0, &buf[0], &n) != nil {
		return ""
	}
	return windows.UTF16ToString(buf[:n])
}

// WaitForOtherInstance shows a small window while a mogugi from another exe
// runs, and once it has quit starts this exe again; it never returns then.
// It only asks the player to quit the other one, it never closes it.
func WaitForOtherInstance(args []string) {
	// Dev instances with their own data dir are meant to run side by side.
	if os.Getenv("MOGUGI_DATA_DIR") != "" {
		return
	}
	inst, ok := app.FindRunningInstance()
	if !ok {
		return
	}
	self, _ := os.Executable()
	running := instanceSide{Version: inst.Version, Path: exePathOf(inst.PID)}
	me := instanceSide{Version: app.Version, Path: self}
	if !needsOtherInstanceDialog(running, me) {
		return
	}
	if runOtherInstanceDialog(running, me, inst.PID) {
		relaunchAfterExit(self, args)
	}
	os.Exit(0)
}

// runOtherInstanceDialog blocks until the other mogugi quits (true) or the
// player cancels (false).
func runOtherInstanceDialog(running, self instanceSide, pid int) bool {
	page := template.Must(template.New("p").Parse(otherInstancePage))
	gone := make(chan struct{})
	var wapp *application.App
	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_ = page.Execute(w, map[string]instanceSide{"Running": running, "Self": self})
	})
	mux.HandleFunc("/icon.png", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "image/png")
		_, _ = w.Write(trayIcon)
	})
	mux.HandleFunc("/cancel", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
		go wapp.Quit()
	})
	wapp = application.New(application.Options{
		Name:   "mogugi",
		Assets: application.AssetOptions{DisableLogging: true, Handler: mux},
		ErrorHandler: func(err error) {
			logger.Printf("other-instance dialog: %v", err)
		},
		Windows: application.WindowsOptions{
			// Not the data dir: the running mogugi may hold that webview profile.
			WebviewUserDataPath: filepath.Join(os.TempDir(), "mogugi-dialog-webview"),
		},
	})
	wapp.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "mogugi",
		Width:            480,
		Height:           380,
		DisableResize:    true,
		InitialPosition:  application.WindowCentered,
		URL:              "/",
		Frameless:        true,
		BackgroundColour: windowBackground,
		Windows:          application.WindowsWindow{DisableFramelessWindowDecorations: false},
	})
	// Quit only once the app runs; an early Quit would be lost.
	wapp.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		go func() {
			waitGone(pid)
			close(gone)
			wapp.Quit()
		}()
	})
	if err := wapp.Run(); err != nil {
		logger.Printf("other-instance dialog: %v", err)
	}
	select {
	case <-gone:
		return true
	default:
		return false
	}
}

// waitGone returns once mogugi pid stops answering and its process has exited
// (so its single-instance lock and port are free).
func waitGone(pid int) {
	for {
		inst, ok := app.FindRunningInstance()
		if !ok || inst.PID != pid {
			break
		}
		time.Sleep(time.Second)
	}
	if h, err := windows.OpenProcess(windows.SYNCHRONIZE, false, uint32(pid)); err == nil {
		_, _ = windows.WaitForSingleObject(h, uint32(relaunchWait/time.Millisecond))
		windows.CloseHandle(h)
	}
}

// relaunchAfterExit starts exe again with args once this process has exited.
func relaunchAfterExit(exe string, args []string) {
	cmd := exec.Command(exe, append([]string{waitPidFlag + strconv.Itoa(os.Getpid())}, args...)...)
	cmd.Dir = filepath.Dir(exe)
	if err := cmd.Start(); err != nil {
		FatalDialog("mogugi", "無法重新啟動 mogugi："+err.Error())
	}
}

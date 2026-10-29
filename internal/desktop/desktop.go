// Package desktop hosts the shared mogugi mux inside a Wails window.
package desktop

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/irusan-fanclub/mogugi/internal/app"
	"github.com/irusan-fanclub/mogugi/lib/util"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/services/notifications"
)

var logger = util.NewLogger("desktop")

// UniqueID names the single-instance lock; dev instances with different
// data dirs get different IDs and can coexist.
func UniqueID(dataDir string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(dataDir)))
	return "mogugi-" + hex.EncodeToString(sum[:])[:12]
}

// routeError shows Wails fatal errors in a dialog (Wails exits right after)
// and sends everything else to the log.
func routeError(err error, dialog func(msg string), log func(msg string)) {
	var fe *application.FatalError
	if errors.As(err, &fe) {
		dialog(fmt.Sprintf("啟動失敗：%v", err))
		return
	}
	log(err.Error())
}

// Shell is the Wails app created before the server exists, so the
// single-instance lock (taken in application.New) precedes any file writes.
type Shell struct {
	wapp *application.App
	mux  atomic.Pointer[http.Handler]
	win  atomic.Pointer[application.WebviewWindow]
	// quitting is set before a real exit so close hooks stop vetoing.
	quitting atomic.Bool
}

// NewShell takes the single-instance lock; a second instance notifies the
// first and exits inside this call.
func NewShell() *Shell {
	sh := &Shell{}
	sh.wapp = application.New(application.Options{
		Name: "mogugi",
		// Ctrl+C is handled in Run, through the same quit as the tray.
		DisableDefaultSignalHandler: true,
		Services:                    []application.Service{application.NewService(notifications.New())},
		ErrorHandler: func(err error) {
			routeError(err, func(m string) { FatalDialog("mogugi", m) },
				func(m string) { logger.Printf("wails: %s", m) })
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: UniqueID(app.DataDir()),
			OnSecondInstanceLaunch: func(application.SecondInstanceData) {
				if w := sh.win.Load(); w != nil {
					showMainWindow(w)
				}
			},
		},
		Assets: application.AssetOptions{DisableLogging: true, Handler: http.HandlerFunc(
			func(w http.ResponseWriter, r *http.Request) {
				if h := sh.mux.Load(); h != nil {
					(*h).ServeHTTP(w, r)
					return
				}
				http.Error(w, "starting", http.StatusServiceUnavailable)
			})},
		Windows: application.WindowsOptions{
			AdditionalBrowserArgs: []string{"--autoplay-policy=no-user-gesture-required"},
			// A tray app; quitting is the tray's job. Otherwise closing the
			// windows on quit would exit early and skip Wails' cleanup.
			DisableQuitOnLastWindowClosed: true,
			WebviewUserDataPath:           dataPath("webview"),
		},
	})
	return sh
}

// quitDrainMax caps how long Quit waits for WebView2 to tear down.
const quitDrainMax = time.Second

// Run opens the main window on the shared mux and blocks until the app exits.
// The same mux also serves 127.0.0.1:<port>, so the browser UI keeps working.
func (sh *Shell) Run(srv *app.Server, stopCapture func()) error {
	wapp := sh.wapp
	var h http.Handler = srv.Mux
	sh.mux.Store(&h)

	selftest := os.Getenv("MOGUGI_SELFTEST") == "arch"
	withFlags := func(u string) string {
		if selftest {
			u += "&selftest=1"
		}
		return u
	}
	cfg := app.CurrentConfig()
	curMode := cfg.DpsDisplay
	first := decideMode("", curMode, srv.Port, true, cfg.AutoOpenBrowser)
	url := withFlags(first.URL)
	logger.Printf("display mode=%s window url=%s openBrowser=%t", curMode, url, first.OpenBrowser)
	saved, trayHintShown := app.LoadDesktopState()
	ws := clampToScreens(saved, screenRects(wapp))
	startState := application.WindowStateNormal
	if saved.Width > 0 && ws.Maximized {
		startState = application.WindowStateMaximised
	}
	win := wapp.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:            "main",
		Title:           "mogugi",
		Width:           ws.Width,
		Height:          ws.Height,
		X:               ws.X,
		Y:               ws.Y,
		InitialPosition: application.WindowXY,
		StartState:      startState,
		MinWidth:        minWinWidth,
		MinHeight:       minWinHeight,
		URL:             url,
		DevToolsEnabled: os.Getenv("MOGUGI_DEVTOOLS") == "1",
		// Frameless keeps the DWM shadow and rounded corners (decorations on).
		Frameless:        true,
		BackgroundColour: windowBackground,
		Windows:          application.WindowsWindow{DisableFramelessWindowDecorations: false},
	})

	sh.win.Store(win)

	saver := newStateSaver(500*time.Millisecond, func(w windowState) {
		if err := app.SaveWindowState(w); err != nil {
			logger.Printf("save window state failed: %v", err)
		}
	})
	trackWindow(win, ws, saver)
	charts := setupChartWindows(wapp, srv.Port, withFlags)
	overlays := setupOverlays(wapp, srv.Port)

	var hintWait ackWaiter
	var hintShown atomic.Bool
	hintShown.Store(trayHintShown)
	win.RegisterHook(events.Common.WindowClosing, func(e *application.WindowEvent) {
		if sh.quitting.Load() {
			return
		}
		e.Cancel()
		if shouldEmitTrayHint(hintShown.Load()) {
			// Stay visible so the user can read the hint; ack hides the window.
			wapp.Event.Emit("desktop:tray-hint")
			// No ack in time: hide anyway, hint stays unshown for next time.
			hintWait.Arm(hintAckTimeout, func() { win.Hide() })
			return
		}
		win.Hide()
	})
	wapp.Event.On("desktop:tray-hint-ack", func(*application.CustomEvent) {
		hintWait.Ack()
		hintShown.Store(true)
		if err := app.MarkTrayHintShown(); err != nil {
			logger.Printf("save trayHintShown failed: %v", err)
		}
		win.Hide()
	})

	quitApp := func() {
		sh.quitting.Store(true)
		saver.Flush()
		charts.Flush()
		overlays.Shutdown()
		if stopCapture != nil {
			stopCapture()
		}
		// Quitting with webviews still open makes WebView2 log "Failed to
		// unregister class Chrome_WidgetWin_0. Error = 1412"; close them and
		// wait for its browser process to exit, as BrowserProcessExited would
		// (Wails keeps that event internal). Off the main thread so the
		// closes can be processed meanwhile.
		go func() {
			for _, w := range wapp.Window.GetAll() {
				w.Close()
			}
			if !waitWebviewExit(webviewBrowsers, quitDrainMax, 25*time.Millisecond) {
				logger.Printf("webview still running after %v, quitting anyway", quitDrainMax)
			}
			wapp.Quit()
		}()
	}
	setupTray(wapp, win, srv.Port, overlays.ToggleLocked, overlays.ToggleHidden, quitApp)
	handleInterrupt(quitApp, os.Exit)
	wapp.Event.On("overlay:restart-elevated", func(*application.CustomEvent) {
		if err := relaunchElevated(); err != nil {
			logger.Printf("relaunch elevated: %v", err)
			overlays.SetElevateError(elevateErrorText(err))
			return
		}
		quitApp()
	})

	browserURL := fmt.Sprintf("http://127.0.0.1:%d/", srv.Port)
	openBrowser := func() {
		if err := wapp.Browser.OpenURL(browserURL); err != nil {
			logger.Printf("open browser failed: %v", err)
		}
	}
	if first.OpenBrowser {
		go openBrowser()
	}
	wapp.Event.On("control:open-browser", func(*application.CustomEvent) { openBrowser() })

	setupReplay(wapp, win, srv.Source)

	var modeMu sync.Mutex
	app.OnConfigChanged = func(app.ConfigSnapshot) {
		// Re-read the latest state: async hooks may arrive out of order.
		latest := app.CurrentConfig()
		var payload map[string]any
		_ = json.Unmarshal(latest.JSON, &payload)
		wapp.Event.Emit("config:changed", payload)

		modeMu.Lock()
		defer modeMu.Unlock()
		d := decideMode(curMode, latest.DpsDisplay, srv.Port, false, latest.AutoOpenBrowser)
		if d.Noop {
			return
		}
		curMode = latest.DpsDisplay
		// The window URL never changes between modes, so no reload here.
		logger.Printf("display mode -> %s openBrowser=%t", curMode, d.OpenBrowser)
		if d.OpenBrowser {
			openBrowser()
		}
	}

	if selftest {
		startArchSelftest(wapp, win, srv.Port)
	}
	return wapp.Run()
}

func screenRects(wapp *application.App) []rect {
	var out []rect
	scr := wapp.Screen.GetAll()
	// Primary first: clampToScreens falls back onto screens[0].
	sort.SliceStable(scr, func(i, j int) bool { return scr[i].IsPrimary && !scr[j].IsPrimary })
	for _, sc := range scr {
		b := sc.Bounds
		out = append(out, rect{b.X, b.Y, b.Width, b.Height})
	}
	return out
}

func dataPath(elem ...string) string { return app.DataPath(elem...) }

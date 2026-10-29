package desktop

import (
	"os"
	"strings"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

// webviewBrowsers counts live msedgewebview2.exe processes whose parent is
// this process: the WebView2 main browser process, which outlives its own
// children, so zero matches what BrowserProcessExited reports.
func webviewBrowsers() (int, error) {
	snap, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPPROCESS, 0)
	if err != nil {
		return 0, err
	}
	defer windows.CloseHandle(snap)
	self := uint32(os.Getpid())
	var e windows.ProcessEntry32
	e.Size = uint32(unsafe.Sizeof(e))
	n := 0
	for err = windows.Process32First(snap, &e); err == nil; err = windows.Process32Next(snap, &e) {
		if e.ParentProcessID == self && strings.EqualFold(windows.UTF16ToString(e.ExeFile[:]), "msedgewebview2.exe") {
			n++
		}
	}
	return n, nil
}

// waitWebviewExit polls count until it reports zero, an error, or timeout
// passes; it returns whether the browser was seen gone.
func waitWebviewExit(count func() (int, error), timeout, step time.Duration) bool {
	deadline := time.Now().Add(timeout)
	for {
		n, err := count()
		if err != nil {
			return false
		}
		if n == 0 {
			return true
		}
		if !time.Now().Before(deadline) {
			return false
		}
		time.Sleep(step)
	}
}

package desktop

import (
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/w32"
	"golang.org/x/sys/windows"
)

// The game reads the mouse through DirectInput, which keeps reporting clicks
// for as long as the game is the foreground window, whichever window is under
// the cursor. So while the overlay is unlocked it must hold the foreground
// itself, and it hands the foreground back to the game when locked again.

var ovAttachThreadInput = gtUser32.NewProc("AttachThreadInput")

// setActivatable lets the overlay take the foreground, or keeps it from ever doing so.
func setActivatable(hwnd unsafe.Pointer, on bool) {
	h := w32.HWND(hwnd)
	ex := w32.GetWindowLong(h, w32.GWL_EXSTYLE)
	if on {
		ex &^= w32.WS_EX_NOACTIVATE
	} else {
		ex |= w32.WS_EX_NOACTIVATE
	}
	w32.SetWindowLong(h, w32.GWL_EXSTYLE, uint32(ex))
}

// takeForeground brings hwnd to the foreground. Windows only lets the
// foreground process do that, so the call joins the foreground thread's input
// queue for its duration.
func takeForeground(hwnd uintptr) {
	fg := w32.GetForegroundWindow()
	if uintptr(fg) == hwnd {
		return
	}
	me := windows.GetCurrentThreadId()
	if fg != 0 {
		other, _ := w32.GetWindowThreadProcessId(fg)
		if uint32(other) != me {
			ovAttachThreadInput.Call(uintptr(me), uintptr(other), 1)
			defer ovAttachThreadInput.Call(uintptr(me), uintptr(other), 0)
		}
	}
	w32.SetForegroundWindow(w32.HWND(hwnd))
}

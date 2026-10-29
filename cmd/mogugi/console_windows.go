package main

import (
	"os"
	"syscall"
	"time"

	"github.com/irusan-fanclub/mogugi/internal/desktop"
)

const (
	ctrlCEvent     = 0
	ctrlBreakEvent = 1
	ctrlCloseEvent = 2
)

// attachParentConsole reconnects stdout/stderr to the launching console for
// a -H windowsgui build (so --help/--version print), and routes that
// console's Ctrl+C to the desktop quit. It does nothing without a console.
func attachParentConsole() {
	const attachParentProcess = ^uintptr(0) // ATTACH_PARENT_PROCESS = (DWORD)-1
	k32 := syscall.NewLazyDLL("kernel32.dll")
	r, _, _ := k32.NewProc("AttachConsole").Call(attachParentProcess)
	if r == 0 {
		return
	}
	// A GUI process inherits "ignore Ctrl+C"; clear it. Go's own handler,
	// set before a console existed, is then still skipped and Ctrl+C would
	// kill the process with no cleanup, so add one that quits properly.
	setHandler := k32.NewProc("SetConsoleCtrlHandler")
	setHandler.Call(0, 0)
	setHandler.Call(syscall.NewCallback(consoleCtrl), 1)
	if f, err := os.OpenFile("CONOUT$", os.O_WRONLY, 0); err == nil {
		os.Stdout, os.Stderr = f, f
	}
}

func consoleCtrl(ev uintptr) uintptr {
	switch ev {
	case ctrlCEvent, ctrlBreakEvent:
		desktop.Interrupt()
		return 1
	case ctrlCloseEvent:
		// Windows ends the process once this returns; give the quit a moment.
		desktop.Interrupt()
		time.Sleep(3 * time.Second)
		return 1
	}
	return 0
}

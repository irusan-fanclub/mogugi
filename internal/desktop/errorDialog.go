package desktop

import (
	"syscall"
	"unsafe"
)

const (
	mbOK        = 0x00000000
	mbIconError = 0x00000010
)

// FatalDialog shows a native error box. It uses MessageBoxW directly because
// it must work before (or without) the Wails application being started.
func FatalDialog(title, msg string) {
	t, _ := syscall.UTF16PtrFromString(title)
	m, _ := syscall.UTF16PtrFromString(msg)
	user32 := syscall.NewLazyDLL("user32.dll")
	user32.NewProc("MessageBoxW").Call(0, uintptr(unsafe.Pointer(m)), uintptr(unsafe.Pointer(t)), mbOK|mbIconError)
}

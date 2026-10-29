//go:build windows

package app

import "golang.org/x/sys/windows"

// openPath opens a file or folder with its default app via ShellExecute; a
// variable so tests never launch anything.
var openPath = func(path string) error {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return err
	}
	verb, _ := windows.UTF16PtrFromString("open")
	return windows.ShellExecute(0, verb, p, nil, nil, windows.SW_SHOWNORMAL)
}

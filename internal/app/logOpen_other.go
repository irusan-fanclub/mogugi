//go:build !windows

package app

import "errors"

// openPath is only supported on Windows; a variable so tests can stub it.
var openPath = func(path string) error { return errors.New("open is only supported on Windows") }

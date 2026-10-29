package app

import (
	"os"
	"path/filepath"
	"strings"
)

// dataDirOverride replaces the data-dir resolution in tests.
var dataDirOverride string

// DataDir is where all runtime data lives: MOGUGI_DATA_DIR if set, else the
// exe's directory. Keep in sync with lib/license's resolution.
func DataDir() string {
	if dataDirOverride != "" {
		return dataDirOverride
	}
	if dir := strings.TrimSpace(os.Getenv("MOGUGI_DATA_DIR")); dir != "" {
		return dir
	}
	if exe, err := os.Executable(); err == nil {
		return filepath.Dir(exe)
	}
	return "."
}

// DataPath joins elem onto DataDir.
func DataPath(elem ...string) string {
	return filepath.Join(append([]string{DataDir()}, elem...)...)
}

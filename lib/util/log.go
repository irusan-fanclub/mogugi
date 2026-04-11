package util

import (
	"io"
	"log"
	"os"
	"path/filepath"
	"sync/atomic"
)

// writer is a process-wide switchable io.Writer used by all loggers
// created via NewLogger. It allows LogInit to redirect every logger's
// output to a file (alongside stdout) without having to re-create them.
var writer = &switchableWriter{}

func init() {
	w := io.Writer(os.Stdout)
	writer.w.Store(&w)
}

var _ io.Writer = (*switchableWriter)(nil)

type switchableWriter struct {
	w atomic.Pointer[io.Writer]
}

func (sw *switchableWriter) Write(p []byte) (n int, err error) {
	return (*sw.w.Load()).Write(p)
}

// LogInit tees every logger's output into the given file in addition
// to stdout. The file (and its parent directory) is created if missing.
func LogInit(logFileName string) error {
	if err := os.MkdirAll(filepath.Dir(logFileName), os.ModePerm); err != nil {
		return err
	}

	fd, err := os.OpenFile(logFileName, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return err
	}

	w := io.MultiWriter(os.Stdout, fd)
	writer.w.Store(&w)
	return nil
}

// NewLogger creates a log.Logger whose output follows the shared
// switchable writer. Call LogInit at program start to enable file logging.
func NewLogger(name string) *log.Logger {
	return log.New(writer, name+" ", log.LstdFlags|log.Lshortfile)
}

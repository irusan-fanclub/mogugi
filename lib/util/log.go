package util

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sync/atomic"
)

// _logModuleWidth is the fixed column width for the module name in
// log output. Set to the longest existing module name ("pcaputil") so
// every line lines up at the message column. Bump this if you add a
// longer name.
const _logModuleWidth = 8

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
//
// Output format: "<date time> [<module padded>] <message>"
// Lshortfile is intentionally omitted — the file:line column varies in
// width and would prevent message alignment.
func NewLogger(name string) *log.Logger {
	prefix := fmt.Sprintf("[%-*s] ", _logModuleWidth, name)
	return log.New(writer, prefix, log.LstdFlags|log.Lmsgprefix)
}

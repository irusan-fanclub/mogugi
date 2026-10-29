package desktop

import (
	"os"
	"os/signal"
	"syscall"
)

// interrupts carries Ctrl+C from an attached console (see cmd/mogugi).
var interrupts = make(chan struct{}, 2)

// Interrupt asks the app to quit as on Ctrl+C; it never blocks.
func Interrupt() {
	select {
	case interrupts <- struct{}{}:
	default:
	}
}

// handleInterrupt quits like the tray on Ctrl+C (or console close); a
// second one calls exit at once in case the quit is stuck.
func handleInterrupt(quit func(), exit func(code int)) {
	sigs := make(chan os.Signal, 2)
	signal.Notify(sigs, os.Interrupt, syscall.SIGTERM)
	next := func() {
		select {
		case <-sigs:
		case <-interrupts:
		}
	}
	go func() {
		next()
		logger.Println("interrupted, quitting")
		quit()
		next()
		logger.Println("interrupted again, exiting now")
		exit(1)
	}()
}

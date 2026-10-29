package desktop

import (
	"testing"
	"time"
)

func TestInterruptQuitsThenForcesExit(t *testing.T) {
	quits, exits := make(chan struct{}, 2), make(chan int, 2)
	handleInterrupt(func() { quits <- struct{}{} }, func(c int) { exits <- c })
	wait := func(name string, ch <-chan struct{}) {
		t.Helper()
		select {
		case <-ch:
		case <-time.After(2 * time.Second):
			t.Fatalf("%s not called", name)
		}
	}
	Interrupt()
	wait("quit", quits)
	Interrupt()
	select {
	case c := <-exits:
		if c != 1 {
			t.Fatalf("exit code %d", c)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("second interrupt did not exit")
	}
	// Nobody listens any more; Interrupt must still never block.
	for range 5 {
		Interrupt()
	}
}

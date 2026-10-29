package desktop

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestAckWaiterTimeoutFires(t *testing.T) {
	var w ackWaiter
	var fired atomic.Bool
	w.Arm(10*time.Millisecond, func() { fired.Store(true) })
	time.Sleep(100 * time.Millisecond)
	if !fired.Load() {
		t.Fatal("timeout did not fire")
	}
	if w.Ack() {
		t.Fatal("late ack reported pending")
	}
}

func TestAckWaiterAckCancels(t *testing.T) {
	var w ackWaiter
	var fired atomic.Bool
	w.Arm(30*time.Millisecond, func() { fired.Store(true) })
	if !w.Ack() {
		t.Fatal("ack not pending")
	}
	time.Sleep(100 * time.Millisecond)
	if fired.Load() {
		t.Fatal("timeout fired after ack")
	}
}

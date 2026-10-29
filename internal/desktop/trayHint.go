package desktop

import (
	"sync"
	"time"
)

// hintAckTimeout bounds how long a window waits for the page to ack the
// tray hint before hiding anyway (a page without the dialog never acks).
const hintAckTimeout = 10 * time.Second

// ackWaiter runs onTimeout unless Ack arrives within the timeout.
type ackWaiter struct {
	mu sync.Mutex
	t  *time.Timer
}

// Arm (re)starts the wait.
func (a *ackWaiter) Arm(d time.Duration, onTimeout func()) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.t != nil {
		a.t.Stop()
	}
	a.t = time.AfterFunc(d, onTimeout)
}

// Ack cancels the pending timeout and reports whether one was pending.
func (a *ackWaiter) Ack() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.t == nil {
		return false
	}
	pending := a.t.Stop()
	a.t = nil
	return pending
}

package app

import "sync"

// captureControl lets the live connection watchdog be paused while a
// replay owns the event source. The zero value is "running".
type captureControl struct {
	mu        sync.Mutex
	isPaused  bool
	reinstall bool
}

func (c *captureControl) Pause() {
	c.mu.Lock()
	c.isPaused = true
	c.mu.Unlock()
}

// Resume re-arms the watchdog to attach to Client.exe from scratch.
func (c *captureControl) Resume() {
	c.mu.Lock()
	c.isPaused = false
	c.reinstall = true
	c.mu.Unlock()
}

func (c *captureControl) paused() bool {
	if c == nil {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.isPaused
}

func (c *captureControl) takeReinstall() bool {
	if c == nil {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	r := c.reinstall
	c.reinstall = false
	return r
}

// switchIfLive runs fn only while not paused, atomically with Pause.
func (c *captureControl) switchIfLive(fn func()) bool {
	if c == nil {
		fn()
		return true
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.isPaused {
		return false
	}
	fn()
	return true
}

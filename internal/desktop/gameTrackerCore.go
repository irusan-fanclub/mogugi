package desktop

import "time"

// minimizedX is where Windows parks a minimized window's client area.
const minimizedX = -32000

// gameObs is one raw observation of the game window.
type gameObs struct {
	HWND          uintptr
	Alive, Iconic bool
	Client        rect // client area in screen coordinates, physical px
}

// gameTrackerCore turns raw observations into gameState updates, emitting at
// most one per minGap and always delivering the latest on Flush.
type gameTrackerCore struct {
	emit     func(gameState)
	minGap   time.Duration
	now      func() time.Time
	last     gameState
	lastAt   time.Time
	pending  gameState
	hasPend  bool
	everSent bool
}

func newGameTrackerCore(emit func(gameState), minGap time.Duration, now func() time.Time) *gameTrackerCore {
	return &gameTrackerCore{emit: emit, minGap: minGap, now: now}
}

func stateOf(o gameObs) gameState {
	if !o.Alive {
		return gameState{}
	}
	if o.Iconic || o.Client.X <= minimizedX {
		return gameState{Found: true, Minimized: true}
	}
	return gameState{Found: true, Rect: o.Client}
}

func (t *gameTrackerCore) Observe(o gameObs) {
	s := stateOf(o)
	if s == t.last {
		t.hasPend = false
		return
	}
	if !t.everSent || t.now().Sub(t.lastAt) >= t.minGap {
		t.send(s)
		return
	}
	t.pending, t.hasPend = s, true
}

// Pending reports whether a state is waiting for its minimum gap to pass.
func (t *gameTrackerCore) Pending() bool { return t.hasPend }

func (t *gameTrackerCore) Flush() {
	if t.hasPend && t.now().Sub(t.lastAt) >= t.minGap {
		t.send(t.pending)
	}
}

func (t *gameTrackerCore) send(s gameState) {
	t.last, t.lastAt, t.hasPend, t.everSent = s, t.now(), false, true
	t.emit(s)
}

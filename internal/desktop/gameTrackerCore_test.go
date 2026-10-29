package desktop

import (
	"testing"
	"time"
)

type trackerHarness struct {
	core *gameTrackerCore
	got  []gameState
	t    time.Time
}

func newTrackerHarness() *trackerHarness {
	h := &trackerHarness{t: time.Unix(1000, 0)}
	h.core = newGameTrackerCore(func(g gameState) { h.got = append(h.got, g) }, 25*time.Millisecond, func() time.Time { return h.t })
	return h
}

func (h *trackerHarness) advance(d time.Duration) { h.t = h.t.Add(d) }

func liveObs(hwnd uintptr, x int) gameObs {
	return gameObs{HWND: hwnd, Alive: true, Client: rect{X: x, Y: 0, W: 1920, H: 1080}}
}

func TestCoalescesBurst(t *testing.T) {
	h := newTrackerHarness()
	for i := 1; i <= 5; i++ {
		h.core.Observe(liveObs(1, i*10))
		h.advance(2 * time.Millisecond)
	}
	if len(h.got) != 1 || h.got[0].Rect.X != 10 {
		t.Fatalf("after burst want only the first state, got %+v", h.got)
	}
	h.core.Flush()
	if len(h.got) != 1 {
		t.Fatalf("flush before the gap passed must not emit, got %+v", h.got)
	}
	h.advance(25 * time.Millisecond)
	h.core.Flush()
	if len(h.got) != 2 || h.got[1].Rect.X != 50 {
		t.Fatalf("flush should emit the last state, got %+v", h.got)
	}
	h.advance(time.Second)
	h.core.Flush()
	if len(h.got) != 2 {
		t.Fatalf("nothing pending, got %+v", h.got)
	}
}

func TestMinimizedByCoords(t *testing.T) {
	h := newTrackerHarness()
	h.core.Observe(gameObs{HWND: 1, Alive: true, Client: rect{X: -48000, Y: -48000}})
	want := gameState{Found: true, Minimized: true}
	if len(h.got) != 1 || h.got[0] != want {
		t.Fatalf("got %+v, want %+v", h.got, want)
	}
}

func TestMinimizedByIconic(t *testing.T) {
	h := newTrackerHarness()
	h.core.Observe(gameObs{HWND: 1, Alive: true, Iconic: true, Client: liveObs(1, 100).Client})
	if len(h.got) != 1 || !h.got[0].Minimized || !h.got[0].Found {
		t.Fatalf("got %+v", h.got)
	}
}

func TestTrackerRefindsAfterWindowGone(t *testing.T) {
	h := newTrackerHarness()
	h.core.Observe(liveObs(1, 0))
	h.advance(time.Second)
	h.core.Observe(gameObs{HWND: 1, Alive: false})
	if last := h.got[len(h.got)-1]; last.Found {
		t.Fatalf("want Found=false, got %+v", last)
	}
	h.advance(time.Second)
	h.core.Observe(liveObs(2, 300))
	last := h.got[len(h.got)-1]
	if !last.Found || last.Rect.X != 300 {
		t.Fatalf("want the new window's rect, got %+v", last)
	}
}

func TestNoEmitWhenUnchanged(t *testing.T) {
	h := newTrackerHarness()
	h.core.Observe(liveObs(1, 0))
	h.advance(time.Second)
	h.core.Observe(liveObs(1, 0))
	h.advance(time.Second)
	h.core.Flush()
	if len(h.got) != 1 {
		t.Fatalf("got %+v", h.got)
	}
}

func TestNoEmitWhenBurstReturnsToEmitted(t *testing.T) {
	h := newTrackerHarness()
	h.core.Observe(liveObs(1, 0))
	h.advance(5 * time.Millisecond)
	h.core.Observe(liveObs(1, 40))
	h.advance(5 * time.Millisecond)
	h.core.Observe(liveObs(1, 0))
	h.advance(time.Second)
	h.core.Flush()
	if len(h.got) != 1 {
		t.Fatalf("got %+v", h.got)
	}
}

func TestFindGameWindowRepeatedly(t *testing.T) {
	for i := 0; i < 3000; i++ {
		findGameWindow()
	}
}

func TestPendingOnlyWhileAStateWaits(t *testing.T) {
	h := newTrackerHarness()
	h.core.Observe(liveObs(1, 0))
	if h.core.Pending() {
		t.Fatal("pending after an immediate send")
	}
	h.advance(5 * time.Millisecond)
	h.core.Observe(liveObs(1, 40))
	if !h.core.Pending() {
		t.Fatal("not pending inside the gap")
	}
	h.advance(time.Second)
	h.core.Flush()
	if h.core.Pending() {
		t.Fatal("pending after flush")
	}
}

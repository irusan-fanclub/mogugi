package desktop

import (
	"sync"
	"testing"
	"time"
)

func TestClampToScreens(t *testing.T) {
	one := []rect{{0, 0, 1920, 1080}}
	two := []rect{{0, 0, 1920, 1080}, {1920, 0, 2560, 1440}}

	got := clampToScreens(windowState{X: 5000, Y: 100, Width: 1000, Height: 700}, one)
	if got.Width != 1000 || got.Height != 700 || got.X < 0 || got.X+got.Width > 1920 || got.Y < 0 || got.Y+got.Height > 1080 {
		t.Fatalf("off-screen: %+v", got)
	}
	got = clampToScreens(windowState{X: 10, Y: 10, Width: 50, Height: 700}, one)
	if got.Width != defaultWinWidth || got.Height != 700 {
		t.Fatalf("tiny width: %+v", got)
	}
	got = clampToScreens(windowState{X: 10, Y: 10, Width: 800, Height: 50}, one)
	if got.Width != 800 || got.Height != defaultWinHeight {
		t.Fatalf("tiny height: %+v", got)
	}
	in := windowState{X: 100, Y: 50, Width: 900, Height: 600, Maximized: true}
	if got = clampToScreens(in, one); got != in {
		t.Fatalf("inside changed: %+v", got)
	}
	in = windowState{X: 2000, Y: 20, Width: 900, Height: 600}
	if got = clampToScreens(in, two); got != in {
		t.Fatalf("second monitor changed: %+v", got)
	}
	// Monitor unplugged: the same state falls back onto the only screen.
	got = clampToScreens(in, one)
	if got.X >= 1920 || got.Width != 900 {
		t.Fatalf("unplugged: %+v", got)
	}
	// Unset state centres the default size.
	got = clampToScreens(windowState{}, one)
	if got.Width != defaultWinWidth || got.X != (1920-defaultWinWidth)/2 {
		t.Fatalf("unset: %+v", got)
	}
}

func TestShouldEmitTrayHint(t *testing.T) {
	if !shouldEmitTrayHint(false) || shouldEmitTrayHint(true) {
		t.Fatal("hint only before it has been shown")
	}
}

func TestStateSaverDebounce(t *testing.T) {
	var mu sync.Mutex
	var saved []windowState
	s := newStateSaver(30*time.Millisecond, func(w windowState) {
		mu.Lock()
		saved = append(saved, w)
		mu.Unlock()
	})
	for i := 1; i <= 5; i++ {
		s.Update(windowState{Width: 100 * i})
	}
	time.Sleep(150 * time.Millisecond)
	mu.Lock()
	if len(saved) != 1 || saved[0].Width != 500 {
		t.Fatalf("saved=%+v", saved)
	}
	mu.Unlock()
	s.Update(windowState{Width: 7})
	s.Flush()
	mu.Lock()
	defer mu.Unlock()
	if len(saved) != 2 || saved[1].Width != 7 {
		t.Fatalf("flush: %+v", saved)
	}
}

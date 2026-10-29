package desktop

import (
	"errors"
	"testing"
	"time"
)

func TestWaitWebviewExitReturnsOnceGone(t *testing.T) {
	left := 3
	calls := 0
	count := func() (int, error) {
		calls++
		left--
		return max(left, 0), nil
	}
	if !waitWebviewExit(count, time.Second, time.Millisecond) {
		t.Fatal("want drained")
	}
	if calls != 3 {
		t.Fatalf("calls = %d, want 3", calls)
	}
}

func TestWaitWebviewExitGivesUpAtTimeout(t *testing.T) {
	start := time.Now()
	if waitWebviewExit(func() (int, error) { return 1, nil }, 30*time.Millisecond, 5*time.Millisecond) {
		t.Fatal("want timeout")
	}
	if d := time.Since(start); d > 500*time.Millisecond {
		t.Fatalf("took %v", d)
	}
}

func TestWaitWebviewExitStopsOnError(t *testing.T) {
	if waitWebviewExit(func() (int, error) { return 0, errors.New("boom") }, time.Second, time.Millisecond) {
		t.Fatal("an error must not count as drained")
	}
}

// The test binary hosts no WebView2, so the real counter reads zero.
func TestWebviewBrowsersNoneInTests(t *testing.T) {
	n, err := webviewBrowsers()
	if err != nil || n != 0 {
		t.Fatalf("n=%d err=%v", n, err)
	}
}

package desktop

import (
	"sync"
	"time"

	"github.com/irusan-fanclub/mogugi/internal/app"
)

type windowState = app.WindowState

type rect struct{ X, Y, W, H int }

const (
	defaultWinWidth    = 1280
	defaultWinHeight   = 800
	minWinWidth        = 640
	minWinHeight       = 400
	minChartWidth      = 360
	minChartHeight     = 240
	defaultChartWidth  = 640
	defaultChartHeight = 420
	// Part of the window that must stay on some screen to be reachable.
	minVisibleW = 120
	minVisibleH = 40
)

func overlap(a, b rect) (w, h int) {
	w = min(a.X+a.W, b.X+b.W) - max(a.X, b.X)
	h = min(a.Y+a.H, b.Y+b.H) - max(a.Y, b.Y)
	return max(w, 0), max(h, 0)
}

// sizeLimits are the minimum and default window size used when clamping.
type sizeLimits struct{ minW, minH, defW, defH int }

var (
	mainLimits  = sizeLimits{minWinWidth, minWinHeight, defaultWinWidth, defaultWinHeight}
	chartLimits = sizeLimits{minChartWidth, minChartHeight, defaultChartWidth, defaultChartHeight}
)

// clampToScreens makes a remembered main window state safe to apply.
func clampToScreens(s windowState, screens []rect) windowState {
	return clampState(s, screens, mainLimits)
}

// clampState makes a remembered state safe to apply: too-small sizes fall
// back to defaults, and a window off every screen moves onto screens[0].
func clampState(s windowState, screens []rect, lim sizeLimits) windowState {
	unset := s.Width <= 0 || s.Height <= 0
	if s.Width < lim.minW {
		s.Width = lim.defW
	}
	if s.Height < lim.minH {
		s.Height = lim.defH
	}
	if len(screens) == 0 {
		return s
	}
	win := rect{s.X, s.Y, s.Width, s.Height}
	if !unset {
		for _, sc := range screens {
			if w, h := overlap(win, sc); w >= minVisibleW && h >= minVisibleH {
				return s
			}
		}
	}
	p := screens[0]
	s.Width, s.Height = min(s.Width, p.W), min(s.Height, p.H)
	s.X = p.X + (p.W-s.Width)/2
	s.Y = p.Y + (p.H-s.Height)/2
	return s
}

// shouldEmitTrayHint: the first close-to-tray explains itself once.
func shouldEmitTrayHint(alreadyShown bool) bool { return !alreadyShown }

// stateSaver coalesces bursts of move/resize updates into one save.
type stateSaver struct {
	mu      sync.Mutex
	delay   time.Duration
	save    func(windowState)
	timer   *time.Timer
	pending *windowState
}

func newStateSaver(delay time.Duration, save func(windowState)) *stateSaver {
	return &stateSaver{delay: delay, save: save}
}

func (s *stateSaver) Update(w windowState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.pending = &w
	if s.timer != nil {
		s.timer.Stop()
	}
	s.timer = time.AfterFunc(s.delay, s.Flush)
}

// Flush saves any pending state immediately.
func (s *stateSaver) Flush() {
	s.mu.Lock()
	w := s.pending
	s.pending = nil
	if s.timer != nil {
		s.timer.Stop()
		s.timer = nil
	}
	s.mu.Unlock()
	if w != nil {
		s.save(*w)
	}
}

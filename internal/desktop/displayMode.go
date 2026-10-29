package desktop

import "fmt"

type modeDecision struct {
	URL         string // main window URL to load
	OpenBrowser bool
	Noop        bool
}

// decideMode maps a DPS display mode change to window and browser actions.
// The main window always shows the desktop UI; web mode only adds the browser.
// prev is "" before the first apply; startup respects autoOpen, switches don't.
func decideMode(prev, next string, port int, startup, autoOpen bool) modeDecision {
	if next == "" {
		next = "desktop"
	}
	if prev == next {
		return modeDecision{Noop: true}
	}
	return modeDecision{
		URL:         fmt.Sprintf("/desktop.html?wsPort=%d", port),
		OpenBrowser: next == "web" && (!startup || autoOpen),
	}
}

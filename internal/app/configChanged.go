package app

import (
	"encoding/json"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
)

// ConfigSnapshot is what the desktop shell needs from the saved config.
type ConfigSnapshot struct {
	DpsDisplay      string
	AutoOpenBrowser bool
	JSON            json.RawMessage // same fields as GET /api/config "file"
}

// OnConfigChanged is set by the desktop shell; called (async) after a
// successful PUT. Receivers should re-read via CurrentConfig for ordering.
var OnConfigChanged func(ConfigSnapshot)

func snapshotOf(c appConfig) ConfigSnapshot {
	b, _ := json.Marshal(c)
	return ConfigSnapshot{DpsDisplay: dpsMode(c.DpsDisplay), AutoOpenBrowser: c.AutoOpenBrowser, JSON: b}
}

// CurrentConfig returns the latest saved config.
func CurrentConfig() ConfigSnapshot {
	appCfgMu.Lock()
	defer appCfgMu.Unlock()
	return snapshotOf(appCfg)
}

// broadcastConfigChanged pushes the saved config to WS clients and the
// desktop hook. The caller may hold appCfgMu, so the hook runs async.
func broadcastConfigChanged(c appConfig) {
	snap := snapshotOf(c)
	if pub := currentPub; pub != nil {
		pub.publish(&event.EventConfigChanged{
			EventBase: event.EventBase{EventId: event.EventIdConfigChanged, At: time.Now().Unix(), Id: "0"},
			Config:    snap.JSON,
		})
		pub.flushNow()
	}
	if h := OnConfigChanged; h != nil {
		go h(snap)
	}
}

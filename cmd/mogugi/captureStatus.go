package main

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gopacket/gopacket/pcap"
	"github.com/irusan-fanclub/mogugi/lib/event"
)

// currentPub is the live event publisher, set by runLive/runFile so
// httpHandlerStatus can read it without threading pub through the HTTP
// route registration.
var currentPub *eventPublisher

// deriveCaptureStatus is the pure state->event derivation: no I/O, so the
// watchdog's Npcap/connection/idle logic is unit-testable in isolation.
// lastPacketAtUnix is 0 when no reader has ever been installed ("never").
func deriveCaptureStatus(npcapOk, gameDetected bool, lastPacketAtUnix int64, now time.Time) event.EventCaptureStatus {
	capturing := lastPacketAtUnix != 0 && now.Unix()-lastPacketAtUnix <= 60
	return event.EventCaptureStatus{
		NpcapOk:      npcapOk,
		GameDetected: gameDetected,
		Capturing:    capturing,
		LastPacketAt: lastPacketAtUnix,
	}
}

// checkNpcapOk reports whether Npcap is installed and enumerable. Cheap
// enough to call at watchdog startup and after a discover failure.
func checkNpcapOk() bool {
	_, err := pcap.FindAllDevs()
	return err == nil
}

// httpHandlerStatus reports live capture status. No license gate: it
// carries no game data, only whether Npcap/the game connection are seen.
func httpHandlerStatus(w http.ResponseWriter, _ *http.Request) {
	var s event.EventCaptureStatus
	if currentPub != nil {
		if cs := currentPub.CaptureStatus(); cs != nil {
			s = *cs
		}
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"NpcapOk":      s.NpcapOk,
		"GameDetected": s.GameDetected,
		"Capturing":    s.Capturing,
		"LastPacketAt": s.LastPacketAt,
	})
}

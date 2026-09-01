package main

import (
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
)

// TestDeriveCaptureStatus locks down the pure state->event derivation the
// watchdog relies on: Npcap/GameDetected pass through, and Capturing is
// true only when a packet was seen within the last 60s.
func TestDeriveCaptureStatus(t *testing.T) {
	now := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	cases := []struct {
		name             string
		npcapOk          bool
		gameDetected     bool
		lastPacketAtUnix int64
		want             event.EventCaptureStatus
	}{
		{
			name:             "npcap missing",
			npcapOk:          false,
			gameDetected:     false,
			lastPacketAtUnix: 0,
			want: event.EventCaptureStatus{
				NpcapOk: false, GameDetected: false, Capturing: false, LastPacketAt: 0,
			},
		},
		{
			name:             "game detected but never captured (reader not installed)",
			npcapOk:          true,
			gameDetected:     true,
			lastPacketAtUnix: 0,
			want: event.EventCaptureStatus{
				NpcapOk: true, GameDetected: true, Capturing: false, LastPacketAt: 0,
			},
		},
		{
			name:             "packet 30s ago is within the idle threshold",
			npcapOk:          true,
			gameDetected:     true,
			lastPacketAtUnix: now.Add(-30 * time.Second).Unix(),
			want: event.EventCaptureStatus{
				NpcapOk: true, GameDetected: true, Capturing: true,
				LastPacketAt: now.Add(-30 * time.Second).Unix(),
			},
		},
		{
			name:             "packet exactly 60s ago is still within threshold",
			npcapOk:          true,
			gameDetected:     true,
			lastPacketAtUnix: now.Add(-60 * time.Second).Unix(),
			want: event.EventCaptureStatus{
				NpcapOk: true, GameDetected: true, Capturing: true,
				LastPacketAt: now.Add(-60 * time.Second).Unix(),
			},
		},
		{
			name:             "packet 90s ago is idle -> not capturing",
			npcapOk:          true,
			gameDetected:     true,
			lastPacketAtUnix: now.Add(-90 * time.Second).Unix(),
			want: event.EventCaptureStatus{
				NpcapOk: true, GameDetected: true, Capturing: false,
				LastPacketAt: now.Add(-90 * time.Second).Unix(),
			},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := deriveCaptureStatus(c.npcapOk, c.gameDetected, c.lastPacketAtUnix, now)
			if got != c.want {
				t.Errorf("deriveCaptureStatus() = %+v, want %+v", got, c.want)
			}
		})
	}
}

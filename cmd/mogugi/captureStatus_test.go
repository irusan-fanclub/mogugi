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

// TestShouldPublishStatus locks down the watchdog's publish-on-change gate:
// only NpcapOk/GameDetected/Capturing matter, LastPacketAt must not (it ticks
// every second while packets flow, which previously caused a publish storm).
func TestShouldPublishStatus(t *testing.T) {
	base := event.EventCaptureStatus{NpcapOk: true, GameDetected: true, Capturing: true, LastPacketAt: 1000}

	cases := []struct {
		name    string
		hasPrev bool
		prev    event.EventCaptureStatus
		next    event.EventCaptureStatus
		want    bool
	}{
		{
			name:    "first status always publishes",
			hasPrev: false,
			prev:    event.EventCaptureStatus{},
			next:    base,
			want:    true,
		},
		{
			name:    "same booleans, different LastPacketAt does not publish",
			hasPrev: true,
			prev:    base,
			next:    event.EventCaptureStatus{NpcapOk: true, GameDetected: true, Capturing: true, LastPacketAt: 5000},
			want:    false,
		},
		{
			name:    "identical status does not publish",
			hasPrev: true,
			prev:    base,
			next:    base,
			want:    false,
		},
		{
			name:    "NpcapOk flip publishes",
			hasPrev: true,
			prev:    base,
			next:    event.EventCaptureStatus{NpcapOk: false, GameDetected: true, Capturing: true, LastPacketAt: 1000},
			want:    true,
		},
		{
			name:    "GameDetected flip publishes",
			hasPrev: true,
			prev:    base,
			next:    event.EventCaptureStatus{NpcapOk: true, GameDetected: false, Capturing: true, LastPacketAt: 1000},
			want:    true,
		},
		{
			name:    "Capturing flip publishes",
			hasPrev: true,
			prev:    base,
			next:    event.EventCaptureStatus{NpcapOk: true, GameDetected: true, Capturing: false, LastPacketAt: 1000},
			want:    true,
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := shouldPublishStatus(c.hasPrev, c.prev, c.next)
			if got != c.want {
				t.Errorf("shouldPublishStatus(%v, %+v, %+v) = %v, want %v", c.hasPrev, c.prev, c.next, got, c.want)
			}
		})
	}
}

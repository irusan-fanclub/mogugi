package app

import (
	"testing"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

func tuairimEvents(p *eventPublisher) []*event.EventTuairim {
	var out []*event.EventTuairim
	for _, e := range p.pendingEvents {
		if te, ok := e.(*event.EventTuairim); ok {
			out = append(out, te)
		}
	}
	return out
}

func TestHandleStatTable_TuairimThrottle(t *testing.T) {
	p := newTestPublisher()
	p.ownerId = 42
	v, mx := uint32(packet.StatTuairim), uint32(packet.StatTuairimMax)
	send := func(pairs ...uint32) { p.handleStatTable(statPacket(42, packet.OpcodeStatUpdatePrivate, pairs...)) }

	send(v, 10, mx, 100) // first reading
	send(v, 10)          // no gain
	send(v, 11)          // a full point
	send(v, 11)          // repeat
	send(v, 100)         // cap
	send(v, 100)         // still capped
	send(v, 0)           // fired
	send(uint32(packet.StatStr), 5)

	var got []float64
	for _, e := range tuairimEvents(p) {
		if e.Max != 100 || e.Id != "42" {
			t.Fatalf("event %+v", e)
		}
		got = append(got, e.Value)
	}
	want := []float64{10, 11, 100, 0}
	if len(got) != len(want) {
		t.Fatalf("values %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("values %v, want %v", got, want)
		}
	}
}

func TestHandleStatTable_TuairimOwnerOnly(t *testing.T) {
	p := newTestPublisher()
	p.ownerId = 42
	p.handleStatTable(statPacket(7, packet.OpcodeStatUpdatePublic, uint32(packet.StatTuairim), 50))
	if n := len(tuairimEvents(p)); n != 0 {
		t.Fatalf("%d events for another entity", n)
	}
}

func TestTuairim_LeadSnapshotAndOverlay(t *testing.T) {
	p := newTestPublisher()
	p.ownerId = 42
	p.handleStatTable(statPacket(42, packet.OpcodeStatUpdatePrivate, uint32(packet.StatTuairim), 30, uint32(packet.StatTuairimMax), 100))
	var lead *event.EventTuairim
	for _, e := range p.leadEventsLocked(false) {
		if te, ok := e.(*event.EventTuairim); ok {
			lead = te
		}
	}
	if lead == nil || lead.Value != 30 {
		t.Fatalf("lead %+v", lead)
	}
	if !overlayWants(lead) || historyKeeps(lead) {
		t.Fatal("tuairim must reach overlays and stay out of history")
	}
	p.setOwnerCharacter(43, "other")
	if p.lastTuairim != nil {
		t.Fatal("owner change kept the old gauge")
	}
}

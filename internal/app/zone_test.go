package app

import (
	"context"
	"testing"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

// zonesOf returns the InDungeon values of every zone event the client received.
func zonesOf(ch chan []event.IEvent) []bool {
	var out []bool
	for {
		select {
		case b := <-ch:
			for _, e := range b {
				if z, ok := e.(*event.EventZone); ok {
					out = append(out, z.InDungeon)
				}
			}
		default:
			return out
		}
	}
}

func TestRegionChangePublishesZone(t *testing.T) {
	p, ch := newBoundaryPublisher(t)
	p.handleSetLocation(setLocationPacket(1, 35001))
	p.handleSetLocation(setLocationPacket(1, 4016))
	p.flushNow()
	got := zonesOf(ch)
	if len(got) != 2 || !got[0] || got[1] {
		t.Fatalf("zone events = %v, want [true false]", got)
	}
}

func TestSessionResetClearsZone(t *testing.T) {
	p, ch := newBoundaryPublisher(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	p.ctx = ctx
	p.packetCh = make(chan *packet.GamePacket, 1)
	p.handleSetLocation(setLocationPacket(1, 35001))
	p.switchReader(nil, "replay", true)
	p.flushNow()
	if got := zonesOf(ch); len(got) != 2 || !got[0] || got[1] {
		t.Fatalf("zone events = %v, want [true false]", got)
	}
	if z := p.zoneEvt.Load(); z == nil || z.InDungeon {
		t.Fatalf("stored zone = %+v, want InDungeon=false", z)
	}
	// The same region again must publish, since the source changed.
	p.handleSetLocation(setLocationPacket(1, 35001))
	p.flushNow()
	if got := zonesOf(ch); len(got) != 1 || !got[0] {
		t.Fatalf("zone events after reset = %v, want [true]", got)
	}
}

// The live game reports its region only on a map change, so returning from a
// replay must bring back the live zone without a new SetLocation.
func TestReturnToLiveRestoresLiveZone(t *testing.T) {
	p, ch := newBoundaryPublisher(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	p.ctx = ctx
	p.packetCh = make(chan *packet.GamePacket, 1)
	p.handleSetLocation(setLocationPacket(1, 35001))
	p.SetReadOnly(true)
	p.switchReader(nil, "replay", true)
	p.handleSetLocation(setLocationPacket(1, 4016)) // the replay's own region
	p.switchReader(nil, "live", true)
	p.SetReadOnly(false)
	p.flushNow()
	got := zonesOf(ch)
	if len(got) == 0 || !got[len(got)-1] {
		t.Fatalf("zone events = %v, want last true", got)
	}
	if z := p.zoneEvt.Load(); z == nil || !z.InDungeon {
		t.Fatalf("stored zone = %+v, want InDungeon=true", z)
	}
}

func TestNewClientGetsLatestZoneFirst(t *testing.T) {
	p, _ := newBoundaryPublisher(t)
	p.handleSetLocation(setLocationPacket(1, 4016))
	p.handleSetLocation(setLocationPacket(1, 35001))
	p.flushNow()

	ch := make(chan []event.IEvent, 10)
	p.addClient(context.Background(), ch)
	got := zonesOf(ch)
	if len(got) != 1 || !got[0] {
		t.Fatalf("addClient zone events = %v, want [true]", got)
	}

	ov := make(chan []event.IEvent, 100)
	p.addClientWithHistory(context.Background(), ov, historyOpts{currentOnly: true, filter: overlayWants})
	got = zonesOf(ov)
	if len(got) == 0 || !got[len(got)-1] {
		t.Fatalf("overlay history zone events = %v, want last true", got)
	}
}

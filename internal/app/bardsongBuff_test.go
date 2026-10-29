package app

import (
	"context"
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

func bardsongPulseAt(at time.Time, performer uint64, sub uint8, targets ...uint64) *packet.GamePacket {
	p := bardsongPulsePacket(performer, sub, targets...)
	p.At = at
	return p
}

func condEvents[T event.IEvent](p *eventPublisher) []T {
	p.Lock()
	defer p.Unlock()
	var out []T
	for _, ev := range p.pendingEvents {
		if e, ok := ev.(T); ok {
			out = append(out, e)
		}
	}
	return out
}

func filterCC900206Enable(es []*event.EventCharacterConditionEnable) []*event.EventCharacterConditionEnable {
	var out []*event.EventCharacterConditionEnable
	for _, e := range es {
		if e.CCId == 900206 {
			out = append(out, e)
		}
	}
	return out
}

func TestBardsongPulseEnablesEachTarget(t *testing.T) {
	p := newEventPublisherForTest(t)
	at := time.UnixMilli(1_700_000_000_000)
	p.handlePacket(bardsongPulseAt(at, 5, 7, 11, 12))

	es := filterCC900206Enable(condEvents[*event.EventCharacterConditionEnable](p))
	if len(es) != 2 {
		t.Fatalf("got %d enables, want 2", len(es))
	}
	want := 1_700_000_020.0
	for _, e := range es {
		if e.DisableAt != want || e.AttackerId != "5" {
			t.Errorf("got %+v, want DisableAt %v attacker 5", e, want)
		}
	}
	if es[0].Id != "11" || es[1].Id != "12" {
		t.Errorf("ids = %s,%s", es[0].Id, es[1].Id)
	}
}

func TestBardsongRefreshExtends(t *testing.T) {
	p := newEventPublisherForTest(t)
	at := time.UnixMilli(1_700_000_000_000)
	p.handlePacket(bardsongPulseAt(at, 5, 7, 11))
	p.handlePacket(bardsongPulseAt(at.Add(10*time.Second), 5, 7, 11))

	es := filterCC900206Enable(condEvents[*event.EventCharacterConditionEnable](p))
	if len(es) != 2 || es[1].DisableAt != 1_700_000_030 {
		t.Fatalf("got %+v", es)
	}
	if n := len(condEvents[*event.EventCharacterConditionDisable](p)); n != 0 {
		t.Errorf("%d disables on refresh", n)
	}
}

func TestBardsongStopDisablesListedTargets(t *testing.T) {
	p := newEventPublisherForTest(t)
	at := time.UnixMilli(1_700_000_000_000)
	p.handlePacket(bardsongPulseAt(at, 5, 7, 11, 12))
	p.handlePacket(bardsongPulseAt(at.Add(3*time.Second), 5, 0, 11))

	ds := condEvents[*event.EventCharacterConditionDisable](p)
	if len(ds) != 1 || ds[0].Id != "11" || ds[0].CCId != 900206 || ds[0].At != 1_700_000_003 {
		t.Fatalf("got %+v", ds)
	}
}

func TestBardsongStopKeepsBuffRefreshedByAnotherBard(t *testing.T) {
	p := newEventPublisherForTest(t)
	at := time.UnixMilli(1_700_000_000_000)
	p.handlePacket(bardsongPulseAt(at, 5, 7, 11))
	p.handlePacket(bardsongPulseAt(at.Add(time.Second), 6, 7, 11))
	p.handlePacket(bardsongPulseAt(at.Add(2*time.Second), 5, 0, 11))

	if n := len(condEvents[*event.EventCharacterConditionDisable](p)); n != 0 {
		t.Fatalf("bard 5 stop disabled bard 6's buff: %d disables", n)
	}
	p.handlePacket(bardsongPulseAt(at.Add(3*time.Second), 6, 0, 11))
	if n := len(condEvents[*event.EventCharacterConditionDisable](p)); n != 1 {
		t.Errorf("bard 6 stop: %d disables, want 1", n)
	}
}

func TestBardsongExpiryDisablesAtExpiryTime(t *testing.T) {
	p := newEventPublisherForTest(t)
	at := time.UnixMilli(1_700_000_000_000)
	p.handlePacket(bardsongPulseAt(at, 5, 7, 11))
	p.handlePacket(bardsongPulseAt(at.Add(50*time.Second), 5, 1))

	ds := condEvents[*event.EventCharacterConditionDisable](p)
	if len(ds) != 1 || ds[0].Id != "11" || ds[0].At != 1_700_000_020 {
		t.Fatalf("got %+v", ds)
	}
	// Already disabled: a later packet must not repeat it.
	p.handlePacket(bardsongPulseAt(at.Add(90*time.Second), 5, 1))
	if n := len(condEvents[*event.EventCharacterConditionDisable](p)); n != 1 {
		t.Errorf("%d disables, want 1", n)
	}
}

func TestBardsongEndNoticeDisablesOwner(t *testing.T) {
	p := newEventPublisherForTest(t)
	at := time.UnixMilli(1_700_000_000_000)
	p.handlePacket(bardsongPulseAt(at, 5, 7, 999, 11))
	n := capturedNoticePacket(t, bodyBardsongEnd)
	n.At = at.Add(4 * time.Second)
	p.handleNotice(n)

	ds := condEvents[*event.EventCharacterConditionDisable](p)
	if len(ds) != 1 || ds[0].Id != "999" || ds[0].At != 1_700_000_004 {
		t.Fatalf("got %+v", ds)
	}
}

func TestBardsongSnapshotHasActiveCondition(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.entityCache.add(&packet.EntityInfo{Id: 11, Name: "x", RaceId: 10001}, time.Unix(1, 0))
	at := time.UnixMilli(1_700_000_000_000)
	p.handlePacket(bardsongPulseAt(at, 5, 7, 11))

	p.Lock()
	evs := p.entityEventsLocked(true, true)
	p.Unlock()
	var got []*event.EventCharacterConditionEnable
	for _, ev := range evs {
		if e, ok := ev.(*event.EventCharacterConditionEnable); ok {
			got = append(got, e)
		}
	}
	got = filterCC900206Enable(got)
	if len(got) != 1 || got[0].DisableAt != 1_700_000_020 || got[0].Id != "11" {
		t.Fatalf("got %+v", got)
	}
}

func TestBardsongSwitchReaderClearsBuffs(t *testing.T) {
	p, _ := newBoundaryPublisher(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	p.ctx = ctx
	p.packetCh = make(chan *packet.GamePacket, 1)
	p.entityCache.add(&packet.EntityInfo{Id: 11, Name: "x", RaceId: 10001}, time.Unix(1, 0))
	at := time.UnixMilli(1_700_000_000_000)
	p.handlePacket(bardsongPulseAt(at, 5, 7, 11))
	p.switchReader(nil, "replay", true)

	p.Lock()
	snap := p.entityEventsLocked(true, true)
	p.Unlock()
	for _, ev := range snap {
		if e, ok := ev.(*event.EventCharacterConditionEnable); ok && e.CCId == 900206 {
			t.Fatalf("snapshot still has %+v", e)
		}
	}
	p.handlePacket(bardsongPulseAt(at.Add(60*time.Second), 5, 1))
	if n := len(condEvents[*event.EventCharacterConditionDisable](p)); n != 0 {
		t.Errorf("%d stale disables after reset", n)
	}
}

func TestBardsongPruneStrayDropsUncachedBuffs(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.entityCache.add(&packet.EntityInfo{Id: 11, Name: "x", RaceId: 10001}, time.Unix(1, 0))
	p.handlePacket(bardsongPulseAt(time.UnixMilli(1_700_000_000_000), 5, 7, 11, 12))
	p.Lock()
	p.pruneStrayLocked()
	_, kept := p.bardsongBuffs[11]
	_, stray := p.bardsongBuffs[12]
	p.Unlock()
	if !kept || stray {
		t.Errorf("kept=%v stray=%v, want true/false", kept, stray)
	}
}

func TestBardsongSnapshotSkipsExpired(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.entityCache.add(&packet.EntityInfo{Id: 11, Name: "x", RaceId: 10001}, time.Unix(1, 0))
	p.handlePacket(bardsongPulseAt(time.UnixMilli(1_700_000_000_000), 5, 7, 11))
	p.Lock()
	p.bardsongNow = 1_700_000_100 // clock moved on without a sweep
	got := p.bardsongSnapshotEventsLocked(11, 1)
	p.Unlock()
	if len(got) != 0 {
		t.Fatalf("got %+v", got)
	}
}

func TestBardsongEnablesAreMarkedLocalClock(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.handlePacket(bardsongPulseAt(time.UnixMilli(1_700_000_000_000), 5, 7, 11))
	es := filterCC900206Enable(condEvents[*event.EventCharacterConditionEnable](p))
	if len(es) != 1 || !es[0].LocalClock {
		t.Fatalf("enables = %+v, want one with LocalClock", es)
	}
	p.Lock()
	defer p.Unlock()
	for _, e := range p.bardsongSnapshotEventsLocked(11, 1) {
		if !e.(*event.EventCharacterConditionEnable).LocalClock {
			t.Error("snapshot enable not marked LocalClock")
		}
	}
}

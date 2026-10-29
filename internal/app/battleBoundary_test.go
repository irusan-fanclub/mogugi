package app

import (
	"context"
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

func newBoundaryPublisher(t *testing.T) (*eventPublisher, chan []event.IEvent) {
	t.Helper()
	p := newEventPublisherForTest(t)
	p.clientMap = make(map[uint32]*eventClient)
	ch := make(chan []event.IEvent, 1<<14)
	p.clientMap[1] = &eventClient{ctx: context.Background(), ch: ch}
	return p, ch
}

// drainIds collects the event ids and Ats of everything the client received.
func drainIds(ch chan []event.IEvent, id event.EventId) []int64 {
	var out []int64
	for {
		select {
		case b := <-ch:
			for _, e := range b {
				if e.GetEventId() == id {
					out = append(out, atOf(e))
				}
			}
		default:
			return out
		}
	}
}

func TestMapChangeStartsSegment(t *testing.T) {
	p, ch := newBoundaryPublisher(t)
	p.handleSetLocation(setLocationPacket(1, 3100))
	p.publish(dmgAt(time.Now().Unix()))
	p.flushNow()
	p.handleSetLocation(setLocationPacket(1, 3200))
	p.publish(dmgAt(time.Now().Unix()))
	p.flushNow()

	if n := len(p.hist.segs); n != 2 {
		t.Fatalf("segments = %d, want 2", n)
	}
	if got := drainIds(ch, event.EventIdBattleBoundary); len(got) != 2 {
		t.Fatalf("boundaries received = %v, want 2", got)
	}
	for _, s := range p.hist.segs {
		if s.pinned {
			t.Fatal("non-whitelisted map change must not pin the segment")
		}
	}
}

func TestWhitelistRunIsOneSegment(t *testing.T) {
	p, ch := newBoundaryPublisher(t)
	p.SetReadOnly(true) // boundaries must not depend on recordBattles
	p.handleQuestInfo(questInfoPacket(7, 717000, "布里萊赫"))
	p.handleSetLocation(setLocationPacket(1, 35011))
	p.handleSetLocation(setLocationPacket(1, 35013))
	p.flushNow()
	if got := drainIds(ch, event.EventIdBattleBoundary); len(got) != 1 {
		t.Fatalf("boundaries inside run = %v, want 1", got)
	}
	if !p.hist.segs[0].pinned {
		t.Fatal("whitelisted run segment must be pinned")
	}
	p.handleSetLocation(setLocationPacket(1, 1))
	p.flushNow()
	if got := drainIds(ch, event.EventIdBattleBoundary); len(got) != 1 {
		t.Fatalf("boundaries after leaving = %v, want 1", got)
	}
}

func TestEvictionBroadcastsHistoryEvicted(t *testing.T) {
	p, ch := newBoundaryPublisher(t)
	p.SetMemoryLimitMB(50)
	per := int(50 << 20 / eventCost(dmgAt(0)) * 4 / 10)
	for i, at := range []int64{1000, 2000, 3000} {
		p.markBattleBoundary(at, true)
		for j := 0; j < per; j++ {
			p.publish(dmgAt(at + int64(i)))
		}
		p.flushNow()
	}
	got := drainIds(ch, event.EventIdHistoryEvicted)
	if len(got) == 0 || got[len(got)-1] != 2000 {
		t.Fatalf("history-evicted Ats = %v, want last 2000", got)
	}
}

func TestSourceResetClearsWhitelistRun(t *testing.T) {
	p, ch := newBoundaryPublisher(t)
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	p.ctx = ctx
	p.packetCh = make(chan *packet.GamePacket, 1)
	p.handleQuestInfo(questInfoPacket(7, 717000, "布里萊赫"))
	p.handleSetLocation(setLocationPacket(1, 35011))
	p.flushNow()
	drainIds(ch, event.EventIdBattleBoundary)

	p.switchReader(nil, "replay", true)
	p.handleQuestInfo(questInfoPacket(7, 717000, "布里萊赫"))
	p.handleSetLocation(setLocationPacket(1, 35013))
	p.flushNow()
	if got := drainIds(ch, event.EventIdBattleBoundary); len(got) != 1 {
		t.Fatalf("boundaries after reset = %v, want 1", got)
	}
	if len(p.hist.segs) == 0 || !p.hist.segs[0].pinned {
		t.Fatal("segment after reset must be pinned")
	}
}

// lastPresent returns the Present list of the last event with the given id.
func lastPresent(ch chan []event.IEvent, id event.EventId) ([]string, bool) {
	var out []string
	found := false
	for {
		select {
		case b := <-ch:
			for _, e := range b {
				if e.GetEventId() != id {
					continue
				}
				found = true
				switch v := e.(type) {
				case *event.EventBattleBoundary:
					out = v.Present
				case *event.EventHistoryEvicted:
					out = v.Present
				}
			}
		default:
			return out, found
		}
	}
}

func TestBoundaryAndEvictionCarryPresentIds(t *testing.T) {
	p, ch := newBoundaryPublisher(t)
	p.entityCache[7] = &entityInfoExtend{EntityInfo: &packet.EntityInfo{Id: 7, Name: "a", RaceId: 10002}}
	p.entityCache[9] = &entityInfoExtend{EntityInfo: &packet.EntityInfo{Id: 9, Name: "b", RaceId: 1}}
	p.markBattleBoundary(1000, true)
	p.flushNow()
	got, ok := lastPresent(ch, event.EventIdBattleBoundary)
	if !ok || len(got) != 2 {
		t.Fatalf("boundary present = %v (found %v), want 2 ids", got, ok)
	}
	m := map[string]bool{got[0]: true, got[1]: true}
	if !m["7"] || !m["9"] {
		t.Fatalf("boundary present = %v, want 7 and 9", got)
	}

	p.SetMemoryLimitMB(50)
	per := int(50 << 20 / eventCost(dmgAt(0)) * 4 / 10)
	for i, at := range []int64{2000, 3000, 4000} {
		p.markBattleBoundary(at, true)
		for j := 0; j < per; j++ {
			p.publish(dmgAt(at + int64(i)))
		}
		p.flushNow()
	}
	got, ok = lastPresent(ch, event.EventIdHistoryEvicted)
	if !ok || len(got) != 2 {
		t.Fatalf("evicted present = %v (found %v), want 2 ids", got, ok)
	}
}

func TestBoundaryPrunesStrayIdState(t *testing.T) {
	p, _ := newBoundaryPublisher(t)
	p.ownerId = 1
	p.statTables = map[uint64]packet.StatTable{}
	p.entityCache[7] = &entityInfoExtend{EntityInfo: &packet.EntityInfo{Id: 7, Name: "a"}}
	for _, id := range []uint64{1, 7, 99} {
		p.maxLifeSeen[id] = 10
		p.deadPlayers[id] = 5
		p.statTables[id] = packet.StatTable{}
	}
	p.bossEntities[99] = "boss" // nameless boss appear: recorded, never cached
	p.lifeSeen[99] = lifeState{}
	p.downedEntities[99] = true
	p.markBattleBoundary(1000, false)
	if _, ok := p.bossEntities[99]; !ok {
		t.Fatal("boss entity must survive a mid-fight boundary")
	}
	if _, ok := p.lifeSeen[99]; !ok || !p.downedEntities[99] {
		t.Fatal("boss life state must survive a mid-fight boundary")
	}
	for _, id := range []uint64{1, 7} {
		if _, ok := p.maxLifeSeen[id]; !ok {
			t.Fatalf("id %d (owner/cached) must keep maxLifeSeen", id)
		}
	}
	if _, ok := p.maxLifeSeen[99]; ok {
		t.Fatal("stray maxLifeSeen not pruned")
	}
	if _, ok := p.deadPlayers[99]; ok {
		t.Fatal("stray deadPlayers not pruned")
	}
	if _, ok := p.statTables[99]; ok {
		t.Fatal("stray statTables not pruned")
	}
}

func TestBoundaryPrunesLifeStateOfNonBossStrays(t *testing.T) {
	p, _ := newBoundaryPublisher(t)
	p.bossEntities[99] = "boss"
	for _, id := range []uint64{98, 99} {
		p.lifeSeen[id] = lifeState{}
		p.downedEntities[id] = true
	}
	p.markBattleBoundary(1000, false)
	if _, ok := p.lifeSeen[98]; ok || p.downedEntities[98] {
		t.Fatal("stray non-boss life state not pruned")
	}
	if _, ok := p.lifeSeen[99]; !ok || !p.downedEntities[99] {
		t.Fatal("boss life state must survive")
	}
}

func TestEntitiesDisappearClearsBoss(t *testing.T) {
	p, _ := newBoundaryPublisher(t)
	p.bossEntities[99] = "boss"
	p.handleEntitiesDisappear(&packet.GamePacket{At: time.Now(), Msg: packet.Message{
		packet.NewMessageElemShort(1), packet.NewMessageElemShort(0), packet.NewMessageElemLong(99),
	}})
	if _, ok := p.bossEntities[99]; ok {
		t.Fatal("boss must be dropped on plural disappear")
	}
}

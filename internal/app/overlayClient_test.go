package app

import (
	"context"
	"testing"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

func idsOf(batches ...[]event.IEvent) (out []event.EventId) {
	for _, b := range batches {
		for _, e := range b {
			out = append(out, e.GetEventId())
		}
	}
	return
}

func drainAll(ch chan []event.IEvent) (out [][]event.IEvent) {
	for {
		select {
		case b := <-ch:
			out = append(out, b)
		default:
			return
		}
	}
}

func TestOverlayClientGetsCurrentSegmentOnly(t *testing.T) {
	_, pub, _ := sourceFixture(t)
	pub.setOwnerCharacter(42, "Hero")
	pub.Lock()
	pub.entityCache[7] = &entityInfoExtend{EntityInfo: &packet.EntityInfo{Id: 7, Name: "Boss"}, appearAt: 100}
	pub.Unlock()
	pub.publish(dmg(1))
	pub.publish(dmgAt(100))
	pub.publish(dmgAt(400)) // > gap: second segment
	pub.flushNow()

	ch := make(chan []event.IEvent, 100)
	pub.addClientWithHistory(context.Background(), ch, historyOpts{currentOnly: true})
	got := drainAll(ch)
	var ids []event.EventId
	for _, b := range got {
		ids = append(ids, idsOf(b)...)
	}
	has := func(id event.EventId) bool {
		for _, x := range ids {
			if x == id {
				return true
			}
		}
		return false
	}
	if !has(event.EventIdOwnerCharacter) || !has(event.EventIdEntityAppear) {
		t.Fatalf("missing lead/entity snapshot: %v", ids)
	}
	var ats []int64
	for _, b := range got {
		for _, e := range b {
			if e.GetEventId() == event.EventIdDamage {
				ats = append(ats, atOf(e))
			}
		}
	}
	if len(ats) != 1 || ats[0] != 400 {
		t.Fatalf("damage ats = %v, want [400]", ats)
	}
}

func TestOverlayCurrentBacklogDedupesConditions(t *testing.T) {
	_, pub, _ := sourceFixture(t)
	pub.Lock()
	pub.entityCache[7] = &entityInfoExtend{
		EntityInfo: &packet.EntityInfo{Id: 7, Name: "Boss"}, appearAt: 100,
		characterConditionMap: map[uint32]*packet.EntityCharacterCondition{
			803: {CCId: 803, DisableAtMs: 900000}, 516: {CCId: 516, DisableAtMs: 900000},
		},
	}
	pub.Unlock()
	pub.publish(dmgAt(400))
	pub.publish(&event.EventCharacterConditionEnable{
		EventBase: event.EventBase{EventId: event.EventIdCharacterConditionEnable, At: 401, Id: "7"},
		CCId:      803, DisableAt: 900,
	})
	pub.flushNow()

	ch := make(chan []event.IEvent, 100)
	pub.addClientWithHistory(context.Background(), ch, historyOpts{currentOnly: true})
	var ats = map[uint32][]int64{}
	for _, b := range drainAll(ch) {
		for _, e := range b {
			if ce, ok := e.(*event.EventCharacterConditionEnable); ok {
				ats[ce.CCId] = append(ats[ce.CCId], ce.At)
			}
		}
	}
	if len(ats[803]) != 1 || ats[803][0] != 401 {
		t.Fatalf("803 enables = %v, want only the in-segment one", ats[803])
	}
	if len(ats[516]) != 1 || ats[516][0] != 0 {
		t.Fatalf("516 enables = %v, want one with At 0", ats[516])
	}
}

func TestOverlayFilterDropsUnwanted(t *testing.T) {
	p, _ := newBoundaryPublisher(t)
	p.clientMap = make(map[uint32]*eventClient)
	ov := make(chan []event.IEvent, 100)
	full := make(chan []event.IEvent, 100)
	p.addClientWithHistory(context.Background(), ov, historyOpts{currentOnly: true, filter: overlayWants})
	p.addClientWithHistory(context.Background(), full, historyOpts{})

	p.publish(&event.EventStatUpdate{EventBase: event.EventBase{EventId: event.EventIdStatUpdate}})
	p.publish(&event.EventOwnerStats{EventBase: event.EventBase{EventId: event.EventIdOwnerStats}})
	p.publish(dmgAt(500))
	p.flushNow()

	if got := idsOf(drainAll(ov)...); len(got) != 1 || got[0] != event.EventIdDamage {
		t.Fatalf("overlay got %v, want [Damage]", got)
	}
	if got := idsOf(drainAll(full)...); len(got) != 3 {
		t.Fatalf("full client got %v, want 3 events", got)
	}
}

func TestOverlayFilterKeepsSystemEvents(t *testing.T) {
	in := []event.IEvent{
		&event.EventBattleBoundary{EventBase: event.EventBase{EventId: event.EventIdBattleBoundary}},
		&event.EventHistoryEvicted{EventBase: event.EventBase{EventId: event.EventIdHistoryEvicted}},
		&event.EventStatUpdate{EventBase: event.EventBase{EventId: event.EventIdStatUpdate}},
	}
	if got := idsOf(filterEvents(in, overlayWants)); len(got) != 2 {
		t.Fatalf("got %v, want the 2 system events", got)
	}
}

// Pinned against front/src/lib/overlayEvents.test.ts.
func TestOverlayWantsIds(t *testing.T) {
	want := []event.EventId{1, 2, 3, 4, 5, 6, 14, 17, 20, 26, 27}
	for id := event.EventId(1); id <= 40; id++ {
		w := false
		for _, x := range want {
			w = w || x == id
		}
		if got := overlayWants(&event.EventBase{EventId: id}); got != w {
			t.Errorf("overlayWants(%d) = %v, want %v", id, got, w)
		}
	}
}

func TestTruncatedHistoryBacklogKeepsActiveCondition(t *testing.T) {
	_, pub, _ := sourceFixture(t)
	pub.SetMemoryLimitMB(50)
	pub.Lock()
	pub.entityCache[7] = &entityInfoExtend{
		EntityInfo: &packet.EntityInfo{Id: 7, Name: "Boss"}, appearAt: 100,
		characterConditionMap: map[uint32]*packet.EntityCharacterCondition{
			803: {CCId: 803, DisableAtMs: 9000000}, 516: {CCId: 516, DisableAtMs: 9000000},
		},
	}
	pub.Unlock()
	per := int(50 << 20 / eventCost(dmgAt(0)) * 4 / 10)
	for i, at := range []int64{1000, 2000, 3000} {
		pub.markBattleBoundary(at, true)
		for j := 0; j < per; j++ {
			pub.publish(dmgAt(at + int64(i)))
		}
		if i == 2 {
			pub.publish(&event.EventCharacterConditionEnable{
				EventBase: event.EventBase{EventId: event.EventIdCharacterConditionEnable, At: 3001, Id: "7"},
				CCId:      803, DisableAt: 9000,
			})
		}
		pub.flushNow()
	}
	pub.Lock()
	truncated, oldest := pub.hist.truncated(), pub.hist.segs[0].start
	pub.Unlock()
	if !truncated {
		t.Fatal("history not truncated")
	}

	ch := make(chan []event.IEvent, 1<<14)
	pub.addClientWithHistory(context.Background(), ch, historyOpts{})
	ats := map[uint32][]int64{}
	for _, b := range drainAll(ch) {
		for _, e := range b {
			if ce, ok := e.(*event.EventCharacterConditionEnable); ok {
				ats[ce.CCId] = append(ats[ce.CCId], ce.At)
			}
		}
	}
	if len(ats[803]) != 1 || ats[803][0] != 3001 {
		t.Fatalf("803 enables = %v, want only the in-segment one", ats[803])
	}
	if len(ats[516]) != 1 || ats[516][0] != oldest {
		t.Fatalf("516 enables = %v, want one at the oldest kept start %d", ats[516], oldest)
	}
}

package app

import (
	"context"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"golang.org/x/net/websocket"
)

func dmg(v float32) event.IEvent {
	return &event.EventDamage{
		EventBase: event.EventBase{EventId: event.EventIdDamage, Id: "1"},
		Damage:    v,
	}
}

func histCount(h *eventHistory) int {
	n := 0
	for _, c := range h.chunks() {
		n += len(c)
	}
	return n
}

func dmgAt(at int64) event.IEvent {
	return &event.EventDamage{
		EventBase: event.EventBase{EventId: event.EventIdDamage, At: at, Id: "1"},
	}
}

func ownerAt(at int64, id string) event.IEvent {
	return &event.EventOwnerCharacter{
		EventBase: event.EventBase{EventId: event.EventIdOwnerCharacter, At: at, Id: id},
	}
}

func TestHistoryGapStartsSegment(t *testing.T) {
	var h eventHistory
	bs, _ := h.append([]event.IEvent{dmgAt(100), dmgAt(110), dmgAt(200)})
	if len(bs) != 1 || bs[0] != 200 {
		t.Fatalf("boundaries = %v, want [200]", bs)
	}
	if len(h.segs) != 2 {
		t.Fatalf("segments = %d, want 2", len(h.segs))
	}
}

func TestHistoryPinnedIgnoresGap(t *testing.T) {
	var h eventHistory
	h.startSegment(100, true)
	bs, _ := h.append([]event.IEvent{dmgAt(100), dmgAt(500)})
	if len(bs) != 0 || len(h.segs) != 1 {
		t.Fatalf("boundaries = %v, segments = %d, want none and 1", bs, len(h.segs))
	}
}

func TestHistoryStartSegmentOnEmptyReusesIt(t *testing.T) {
	var h eventHistory
	h.startSegment(100, false)
	h.startSegment(150, true)
	if len(h.segs) != 1 || !h.segs[0].pinned || h.segs[0].start != 150 {
		t.Fatalf("segs = %+v, want one pinned segment at 150", h.segs)
	}
}

func TestHistoryEvictsOldestWholeSegment(t *testing.T) {
	var h eventHistory
	h.setBudget(2 * eventCost(dmgAt(0)))
	h.append([]event.IEvent{dmgAt(100)})
	h.append([]event.IEvent{dmgAt(200)})
	_, ev := h.append([]event.IEvent{dmgAt(300)})
	if ev != 200 {
		t.Fatalf("evictedBefore = %d, want 200", ev)
	}
	for _, c := range h.chunks() {
		for _, e := range c {
			if e.(*event.EventDamage).At == 100 {
				t.Fatal("first segment still present")
			}
		}
	}
	if !h.truncated() {
		t.Fatal("truncated() = false")
	}
	if h.bytes() > 2*eventCost(dmgAt(0)) {
		t.Fatalf("bytes = %d over budget", h.bytes())
	}
}

func TestHistoryEvictsOversizedEndedSegmentWhole(t *testing.T) {
	var h eventHistory
	h.setBudget(eventCost(dmgAt(0)))
	h.startSegment(10, true)
	h.append([]event.IEvent{dmgAt(10), dmgAt(11), dmgAt(12)})
	h.startSegment(20, true)
	_, ev := h.append([]event.IEvent{dmgAt(20)})
	if ev != 20 || histCount(&h) != 1 {
		t.Fatalf("evictedBefore = %d, kept = %d, want 20 and 1", ev, histCount(&h))
	}
}

func TestHistoryNeverEvictsCurrentSegment(t *testing.T) {
	var h eventHistory
	h.setBudget(1)
	_, ev := h.append([]event.IEvent{dmgAt(1), dmgAt(2)})
	if ev != 0 || histCount(&h) != 2 || h.truncated() {
		t.Fatalf("evictedBefore = %d, kept = %d, truncated = %v", ev, histCount(&h), h.truncated())
	}
}

// The bard-song lane reads pulses against the character logged in then, so an
// owner change evicted with its segment must still lead the replay.
func TestHistoryKeepsLostOwnerAcrossEviction(t *testing.T) {
	var h eventHistory
	h.setBudget(eventCost(dmgAt(0)))
	h.append([]event.IEvent{ownerAt(1, "a"), ownerAt(2, "b")})
	h.append([]event.IEvent{dmgAt(100)})
	h.append([]event.IEvent{dmgAt(200)})
	cs := h.chunks()
	if o, ok := cs[0][0].(*event.EventOwnerCharacter); !ok || o.Id != "b" || o.At != 2 {
		t.Fatalf("chunks()[0][0] = %+v, want owner b at 2", cs[0][0])
	}

	h.reset()
	h.append([]event.IEvent{dmg(1)})
	if cs := h.chunks(); len(cs) != 1 || cs[0][0].GetEventId() != event.EventIdDamage {
		t.Fatalf("after reset = %v, want no carried owner", cs)
	}
}

func TestHistoryCurrentChunks(t *testing.T) {
	var h eventHistory
	h.append([]event.IEvent{ownerAt(1, "a"), dmgAt(100), dmgAt(200), dmgAt(300)})
	cs := h.currentChunks()
	n := 0
	for _, c := range cs {
		for _, e := range c {
			if e.GetEventId() == event.EventIdDamage && e.(*event.EventDamage).At != 300 {
				t.Fatalf("currentChunks has older damage %v", e)
			}
			n++
		}
	}
	if n != 1 {
		t.Fatalf("currentChunks has %d events, want 1", n)
	}
}

func TestHistoryCurrentChunksLeadsWithLostOwner(t *testing.T) {
	var h eventHistory
	h.setBudget(eventCost(dmgAt(0)))
	h.append([]event.IEvent{ownerAt(1, "a"), dmgAt(100)})
	h.append([]event.IEvent{dmgAt(200)})
	cs := h.currentChunks()
	if len(cs) != 2 || cs[0][0].GetEventId() != event.EventIdOwnerCharacter {
		t.Fatalf("currentChunks = %v, want lostOwner then last segment", cs)
	}
}

func TestHistoryFiltersSystemAndSnapshotEvents(t *testing.T) {
	var h eventHistory
	mk := func(id event.EventId) event.IEvent {
		return &event.EventBase{EventId: id}
	}
	h.append([]event.IEvent{
		mk(event.EventIdSessionReset), mk(event.EventIdSourceChanged),
		mk(event.EventIdStatUpdate), mk(event.EventIdCaptureStatus),
		mk(event.EventIdOwnerStats), mk(event.EventIdOwnerEquipment),
		dmg(7),
	})
	cs := h.chunks()
	if len(cs) != 1 || len(cs[0]) != 1 || cs[0][0].GetEventId() != event.EventIdDamage {
		t.Fatalf("history = %v, want only the Damage", cs)
	}
}

func TestHistoryResetOnlyOnSourceSwitch(t *testing.T) {
	for _, tc := range []struct {
		reason string
		keep   bool
	}{{"replay", false}, {"live", false}, {"idle_fallback", true}} {
		t.Run(tc.reason, func(t *testing.T) {
			_, pub, _ := sourceFixture(t)
			pub.publish(dmg(1))
			pub.flushNow()
			pub.switchReader(nil, tc.reason, true)
			pub.Lock()
			n := histCount(&pub.hist)
			pub.Unlock()
			if (n > 0) != tc.keep {
				t.Fatalf("history len after %q = %d, keep=%v", tc.reason, n, tc.keep)
			}
		})
	}
}

func damages(batches ...[]event.IEvent) (out []float32) {
	for _, b := range batches {
		for _, e := range b {
			if d, ok := e.(*event.EventDamage); ok {
				out = append(out, d.Damage)
			}
		}
	}
	return
}

func TestAddClientWithHistoryOrder(t *testing.T) {
	_, pub, _ := sourceFixture(t)
	pub.setOwnerCharacter(42, "Hero")
	for i := 0; i < 3; i++ {
		pub.publish(dmg(float32(i)))
	}
	pub.flushNow()

	ch := make(chan []event.IEvent, 100)
	pub.addClientWithHistory(context.Background(), ch, historyOpts{})

	// Lead snapshot first, then the 3 damages.
	lead := <-ch
	if lead[0].GetEventId() != event.EventIdOwnerCharacter {
		t.Fatalf("first event = %d, want OwnerCharacter", lead[0].GetEventId())
	}
	hist := <-ch
	if got := damages(hist); len(got) != 3 || got[0] != 0 || got[2] != 2 {
		t.Fatalf("history damages = %v", got)
	}

	pub.publish(dmg(99))
	pub.flushNow()
	live := <-ch
	if got := damages(live); len(got) != 1 || got[0] != 99 {
		t.Fatalf("live damages = %v", got)
	}
	select {
	case extra := <-ch:
		t.Fatalf("unexpected extra batch %v", extra)
	default:
	}
}

func TestAddClientWithHistoryConcurrentPublish(t *testing.T) {
	_, pub, _ := sourceFixture(t)
	const n = 1000
	ch := make(chan []event.IEvent, 10000)

	mid := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 0; i < n; i++ {
			pub.publish(dmg(float32(i)))
			if i%50 == 0 {
				pub.flushNow()
			}
			if i == n/2 {
				close(mid)
			}
		}
	}()
	go func() {
		defer wg.Done()
		<-mid
		pub.addClientWithHistory(context.Background(), ch, historyOpts{})
	}()
	wg.Wait()
	pub.flushNow()

	seen := make(map[float32]int)
	for len(ch) > 0 {
		for _, d := range damages(<-ch) {
			seen[d]++
		}
	}
	for i := 0; i < n; i++ {
		if seen[float32(i)] != 1 {
			t.Fatalf("damage %d seen %d times, want 1", i, seen[float32(i)])
		}
	}
}

func TestWsHistoryParam(t *testing.T) {
	_, pub, _ := sourceFixture(t)
	pub.publish(dmg(5))
	pub.flushNow()

	srv := httptest.NewServer(websocket.Handler(websocketHandler(pub)))
	defer srv.Close()
	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")

	firstFrame := func(query string) []event.IEvent {
		ws, err := websocket.Dial(wsURL+query, "", srv.URL)
		if err != nil {
			t.Fatal(err)
		}
		defer ws.Close()
		ws.SetReadDeadline(time.Now().Add(300 * time.Millisecond))
		var raw []struct {
			EventId event.EventId
			Damage  float32
		}
		if err := websocket.JSON.Receive(ws, &raw); err != nil {
			return nil // no frame: nothing to replay
		}
		var out []event.IEvent
		for _, r := range raw {
			if r.EventId == event.EventIdDamage {
				out = append(out, dmg(r.Damage))
			}
		}
		return out
	}

	if got := firstFrame("/?history=1"); len(got) != 1 {
		t.Fatalf("history=1 frame damages = %d, want 1", len(got))
	}
	if got := firstFrame("/"); len(got) != 0 {
		t.Fatalf("plain /ws frame has %d damages, want 0", len(got))
	}
}

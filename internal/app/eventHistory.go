package app

import "github.com/irusan-fanclub/mogugi/lib/event"

const (
	historyChunkEvents = 2000
	historyGapSeconds  = 60
)

// eventCost estimates the bytes one event holds in the backend history plus
// one UI window. Measured on a 2.4M-event replay (backend 96/481/~150 B,
// frontend ~618/~278/~86 B for damage/condition/other).
func eventCost(e event.IEvent) int64 {
	switch e.GetEventId() {
	case event.EventIdDamage:
		return 700
	case event.EventIdCharacterConditionEnable:
		return 750
	default:
		return 250
	}
}

// histSegment is one battle's events, chunked to avoid copying big slices.
type histSegment struct {
	start        int64
	pinned       bool
	lastDamageAt int64
	cost         int64
	events       [][]event.IEvent
	n            int
}

// eventHistory keeps the current source's events in battle segments so the
// oldest can be dropped whole under a byte budget. Not safe for concurrent
// use; the publisher's mutex guards it.
type eventHistory struct {
	segs   []histSegment
	total  int64
	budget int64
	cut    bool
	// lostOwner is the last owner change evicted with an old segment; replays
	// lead with it so older fights keep the character that played them.
	lostOwner event.IEvent
}

// historyKeeps reports whether an event belongs in the history. System events
// and the ones the lead snapshot replays are left out.
func historyKeeps(e event.IEvent) bool {
	switch id := e.GetEventId(); id {
	case event.EventIdStatUpdate, event.EventIdCaptureStatus,
		event.EventIdOwnerEquipment, event.EventIdOwnerStats, event.EventIdOwnerProfile,
		event.EventIdTuairim:
		return false
	default:
		return id > 0
	}
}

func atOf(e event.IEvent) int64 {
	if a, ok := e.(interface{ GetAt() int64 }); ok {
		return a.GetAt()
	}
	return 0
}

// setBudget sets the byte budget; 0 means unlimited.
func (h *eventHistory) setBudget(bytes int64) { h.budget = bytes }

// startSegment opens a segment for the next event; an empty current one is
// reused.
func (h *eventHistory) startSegment(at int64, pinned bool) {
	if n := len(h.segs); n > 0 && h.segs[n-1].n == 0 {
		h.segs[n-1].start = at
		h.segs[n-1].pinned = pinned
		return
	}
	h.segs = append(h.segs, histSegment{start: at, pinned: pinned})
}

// append stores the batch, returns the starts of gap-opened segments and, if
// the budget forced eviction, the new oldest segment's start (else 0).
func (h *eventHistory) append(batch []event.IEvent) (boundaries []int64, evictedBefore int64) {
	for _, e := range batch {
		if !historyKeeps(e) {
			continue
		}
		if len(h.segs) == 0 {
			h.segs = append(h.segs, histSegment{start: atOf(e)})
		}
		isDmg := e.GetEventId() == event.EventIdDamage
		var at int64
		if isDmg {
			at = atOf(e)
			cur := &h.segs[len(h.segs)-1]
			if !cur.pinned && cur.lastDamageAt != 0 && at-cur.lastDamageAt > historyGapSeconds {
				h.segs = append(h.segs, histSegment{start: at})
				boundaries = append(boundaries, at)
			}
		}
		cur := &h.segs[len(h.segs)-1]
		if isDmg {
			cur.lastDamageAt = at
		}
		if k := len(cur.events); k == 0 || len(cur.events[k-1]) >= historyChunkEvents {
			cur.events = append(cur.events, nil)
		}
		k := len(cur.events) - 1
		cur.events[k] = append(cur.events[k], e)
		cur.n++
		c := eventCost(e)
		cur.cost += c
		h.total += c
	}
	for h.budget > 0 && h.total > h.budget && len(h.segs) > 1 {
		old := &h.segs[0]
		for _, c := range old.events {
			for _, e := range c {
				if e.GetEventId() == event.EventIdOwnerCharacter {
					h.lostOwner = e
				}
			}
		}
		h.total -= old.cost
		h.segs[0] = histSegment{}
		h.segs = h.segs[1:]
		h.cut = true
		evictedBefore = h.segs[0].start
	}
	return boundaries, evictedBefore
}

func (h *eventHistory) reset() { *h = eventHistory{budget: h.budget} }

// chunks returns a shallow copy, led by the last evicted owner change if
// any; the events inside are read-only.
func (h *eventHistory) chunks() [][]event.IEvent {
	var out [][]event.IEvent
	if h.lostOwner != nil {
		out = append(out, []event.IEvent{h.lostOwner})
	}
	for i := range h.segs {
		out = append(out, h.segs[i].events...)
	}
	return out
}

// currentChunks is lostOwner plus the last segment only.
func (h *eventHistory) currentChunks() [][]event.IEvent {
	var out [][]event.IEvent
	if h.lostOwner != nil {
		out = append(out, []event.IEvent{h.lostOwner})
	}
	if n := len(h.segs); n > 0 {
		out = append(out, h.segs[n-1].events...)
	}
	return out
}

func (h *eventHistory) bytes() int64 { return h.total }

// truncated reports whether old events were ever dropped.
func (h *eventHistory) truncated() bool { return h.cut }

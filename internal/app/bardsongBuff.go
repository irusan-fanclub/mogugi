package app

import (
	"sort"
	"strconv"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

// bardsongCCId is the synthetic condition id for 戰吼; the game sends no real
// condition for it, so it is derived from bardsong pulses.
const bardsongCCId uint32 = 900206

// bardsongPulseWindow is how long one pulse keeps the buff alive.
const bardsongPulseWindow = 20 * time.Second

// bardsongBuff is one target's active 戰吼. expiry is local Unix seconds
// (capture time based), never a server clock value.
type bardsongBuff struct {
	expiry     float64
	attackerId uint64
}

func localSec(at time.Time) float64 { return float64(at.UnixMilli()) / 1000 }

func (t *eventPublisher) bardsongCondEvent(id uint64, b bardsongBuff, at int64, enable bool) event.IEvent {
	base := event.EventBase{At: at, Id: strconv.FormatUint(id, 10)}
	if !enable {
		base.EventId = event.EventIdCharacterConditionDisable
		return &event.EventCharacterConditionDisable{EventBase: base, CCId: bardsongCCId}
	}
	base.EventId = event.EventIdCharacterConditionEnable
	return &event.EventCharacterConditionEnable{
		EventBase:  base,
		CCId:       bardsongCCId,
		DisableAt:  b.expiry,
		LocalClock: true,
		AttackerId: strconv.FormatUint(b.attackerId, 10),
		Params:     map[string]string{},
	}
}

// expireBardsongBuffs disables buffs whose expiry passed before `now`, at the
// expiry time. Driven by packet time so it works live and in replay.
func (t *eventPublisher) expireBardsongBuffs(now time.Time) {
	nowSec := localSec(now)
	t.Lock()
	t.bardsongNow = nowSec
	var ids []uint64
	for id, b := range t.bardsongBuffs {
		if b.expiry < nowSec {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	var events []event.IEvent
	for _, id := range ids {
		b := t.bardsongBuffs[id]
		delete(t.bardsongBuffs, id)
		events = append(events, t.bardsongCondEvent(id, b, int64(b.expiry), false))
	}
	t.Unlock()
	for _, e := range events {
		t.publish(e)
	}
}

// applyBardsongPulse enables (hit) or disables (stop) the buff on targets.
func (t *eventPublisher) applyBardsongPulse(p *packet.GamePacket, targets []string, stop bool) {
	at := p.At.Unix()
	t.Lock()
	if t.bardsongBuffs == nil {
		t.bardsongBuffs = make(map[uint64]bardsongBuff)
	}
	var events []event.IEvent
	for _, s := range targets {
		id, err := strconv.ParseUint(s, 10, 64)
		if err != nil {
			continue
		}
		if stop {
			// Only the bard that last refreshed the buff may stop it.
			if b, ok := t.bardsongBuffs[id]; ok && b.attackerId == p.Id {
				delete(t.bardsongBuffs, id)
				events = append(events, t.bardsongCondEvent(id, b, at, false))
			}
			continue
		}
		b := bardsongBuff{expiry: localSec(p.At) + bardsongPulseWindow.Seconds(), attackerId: p.Id}
		t.bardsongBuffs[id] = b
		events = append(events, t.bardsongCondEvent(id, b, at, true))
	}
	t.Unlock()
	for _, e := range events {
		t.publish(e)
	}
}

// endOwnerBardsong disables the owner's buff on a bardsong end notice.
func (t *eventPublisher) endOwnerBardsong(at int64) {
	t.Lock()
	id := t.ownerId
	b, ok := t.bardsongBuffs[id]
	delete(t.bardsongBuffs, id)
	t.Unlock()
	if ok {
		t.publish(t.bardsongCondEvent(id, b, at, false))
	}
}

// bardsongSnapshotEventsLocked lists active buffs of a cached entity for an
// F5 snapshot. Caller holds the lock.
func (t *eventPublisher) bardsongSnapshotEventsLocked(id uint64, at int64) []event.IEvent {
	b, ok := t.bardsongBuffs[id]
	if !ok || b.expiry < t.bardsongNow {
		return nil
	}
	return []event.IEvent{t.bardsongCondEvent(id, b, at, true)}
}

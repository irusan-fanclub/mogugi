package main

import (
	"reflect"
	"sort"
	"strconv"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

// equipPockets are the spec's 20 worn slots (incl. 星塵 54); 48/90 (時裝欄) and 12
// (unidentified, seen once in a set switch) are deliberately excluded.
// See iruneko analysis/20260905_equip-change-packets.md.
var equipPockets = map[uint32]bool{
	5: true, 6: true, 7: true, 8: true, 9: true, // 衣服 手部 腳部 頭部 長袍
	10: true, 11: true, 13: true, 14: true, // 主手 背後主手 副手 背後副手
	16: true, 17: true, // 左右飾品
	32: true, 33: true, 34: true, 35: true, // 遺物 1-4
	51: true, 54: true, // 威光 星塵
	62: true, 63: true, 64: true, // 回音石 1-3
}

// setOwnerItemsLocked replaces the in-memory owner inventory. Caller holds t.Lock.
func (t *eventPublisher) setOwnerItemsLocked(items []packet.InventoryItem) {
	t.ownerItems = make(map[uint64]packet.InventoryItem, len(items))
	for _, it := range items {
		t.ownerItems[it.EID] = it
	}
}

// ownerEquipmentLocked returns the worn subset sorted by pocket. Caller holds t.Lock.
func (t *eventPublisher) ownerEquipmentLocked() []packet.InventoryItem {
	out := make([]packet.InventoryItem, 0, len(equipPockets))
	for _, it := range t.ownerItems {
		if equipPockets[it.Pocket] {
			out = append(out, it)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Pocket < out[j].Pocket })
	return out
}

// ownerEquipmentEventLocked builds the full worn-set event. Caller holds t.Lock.
func (t *eventPublisher) ownerEquipmentEventLocked(at int64) *event.EventOwnerEquipment {
	worn := t.ownerEquipmentLocked()
	items := make([]event.EquipmentItem, 0, len(worn))
	for _, it := range worn {
		items = append(items, event.EquipmentItem{
			Pocket: it.Pocket,
			EID:    strconv.FormatUint(it.EID, 10),
			Item:   indexItemFromInventory(it),
		})
	}
	return &event.EventOwnerEquipment{
		EventBase: event.EventBase{
			EventId: event.EventIdOwnerEquipment,
			At:      at,
			Id:      strconv.FormatUint(t.ownerId, 10),
		},
		Items: items,
	}
}

// publishOwnerEquipment snapshots the worn set under the lock and publishes
// it only if it differs from the last published set (a byte-identical resend,
// e.g. a stale 0x5BD4 corrected moments later by 0x59E0, must not republish).
func (t *eventPublisher) publishOwnerEquipment(at int64) {
	t.Lock()
	e := t.ownerEquipmentEventLocked(at)
	if reflect.DeepEqual(e.Items, t.lastOwnerEquip) {
		t.Unlock()
		return
	}
	t.lastOwnerEquip = e.Items
	t.Unlock()
	t.publish(e)
}

// ownerStatsLocked builds the owner's panel event, or nil when there is no
// owner or no stat table yet. Caller holds t.Lock.
func (t *eventPublisher) ownerStatsLocked(at int64) *event.EventOwnerStats {
	if t.ownerId == 0 {
		return nil
	}
	st, ok := t.statTables[t.ownerId]
	if !ok {
		return nil
	}
	return &event.EventOwnerStats{
		EventBase: event.EventBase{
			EventId: event.EventIdOwnerStats,
			At:      at,
			Id:      strconv.FormatUint(t.ownerId, 10),
		},
		Panel: st.Panel(),
	}
}

// panelChangedBeyondCurrent reports whether a and b differ in anything
// other than the current Life/Mana/Stamina values.
func panelChangedBeyondCurrent(a, b packet.Panel) bool {
	a.Life, a.Mana, a.Stamina = 0, 0, 0
	b.Life, b.Mana, b.Stamina = 0, 0, 0
	return a != b
}

// ownerStatsIfChangedLocked is ownerStatsLocked deduped against the last
// published panel (0x7532 repeats thousands of times); a Life/Mana/Stamina-only
// change is throttled to once per second. Caller holds t.Lock.
func (t *eventPublisher) ownerStatsIfChangedLocked(at int64) *event.EventOwnerStats {
	e := t.ownerStatsLocked(at)
	if e == nil {
		return nil
	}
	if t.lastOwnerPanel != nil {
		if *t.lastOwnerPanel == e.Panel {
			return nil
		}
		if !panelChangedBeyondCurrent(*t.lastOwnerPanel, e.Panel) && at == t.lastOwnerStatsAt {
			return nil
		}
	}
	panel := e.Panel
	t.lastOwnerPanel = &panel
	t.lastOwnerStatsAt = at
	return e
}

// applyOwnerItemLocked overwrites one owner item by EID (a full record from
// 0x59E0/0x5BD4); returns whether the worn set may have changed (old or new
// pocket is worn). False before any snapshot. Caller holds t.Lock.
func (t *eventPublisher) applyOwnerItemLocked(it packet.InventoryItem) bool {
	if t.ownerItems == nil {
		return false
	}
	old, existed := t.ownerItems[it.EID]
	t.ownerItems[it.EID] = it
	return (existed && equipPockets[old.Pocket]) || equipPockets[it.Pocket]
}

// moveOwnerItemLocked applies a 0x59DE move to a known owner item and
// reports whether the worn set may have changed (source or destination is
// a worn pocket). False for unknown EIDs or before any snapshot. Caller holds t.Lock.
func (t *eventPublisher) moveOwnerItemLocked(eid uint64, pocket, x, y uint32) bool {
	it, ok := t.ownerItems[eid]
	if !ok {
		return false
	}
	wornBefore := equipPockets[it.Pocket]
	it.Pocket, it.PosX, it.PosY = pocket, x, y
	it.Container = packet.ContainerForPocket(pocket)
	t.ownerItems[eid] = it
	return wornBefore || equipPockets[pocket]
}

// handleOwnerItemMove applies a 0x59DE move. Research 2026-09-05: the body
// is (Long eid, Int from, Int to, Byte 2, Byte x, Byte y); it precedes the
// 0x59E6/0x59E7 appearance packet of the same drag by 0-3 ms.
func (t *eventPublisher) handleOwnerItemMove(p *packet.GamePacket) {
	if len(p.Msg) < 6 || p.Msg[0].Type() != packet.MessageElemTypeLong ||
		p.Msg[2].Type() != packet.MessageElemTypeInt ||
		p.Msg[4].Type() != packet.MessageElemTypeByte || p.Msg[5].Type() != packet.MessageElemTypeByte {
		return
	}
	eid := p.Msg[0].Data().(uint64)
	to := p.Msg[2].Data().(uint32)
	x := uint32(p.Msg[4].Data().(uint8))
	y := uint32(p.Msg[5].Data().(uint8))

	t.Lock()
	changed := p.Id == t.ownerId && t.moveOwnerItemLocked(eid, to, x, y)
	t.Unlock()
	if changed {
		t.publishOwnerEquipment(p.At.Unix())
	}
}

// handleOwnerItemRecord applies a 0x59E0 / 0x5BD4 body (one full ItemRecord;
// OwnerCEID is the LAST element, never msg[10]). A 0x5BD4 resend may carry a
// stale pocket that the following 0x59E0 corrects within a few ms.
func (t *eventPublisher) handleOwnerItemRecord(p *packet.GamePacket) {
	t.Lock()
	isOwner := p.Id == t.ownerId
	t.Unlock()
	if !isOwner {
		return // foreign body: skip parsing and logging entirely
	}

	it, _, ok := packet.ParseItemRecordAt(p.Msg, 0)
	if !ok {
		logger.Printf("%s: unrecognised ItemRecord body elems=%d", p.Op, len(p.Msg))
		return
	}
	t.Lock()
	changed := t.applyOwnerItemLocked(it)
	t.Unlock()
	if changed {
		t.publishOwnerEquipment(p.At.Unix())
	}
}

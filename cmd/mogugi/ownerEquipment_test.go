package main

import (
	"encoding/hex"
	"reflect"
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

// itemEntry builds one [Long eid][Byte 2][Bin 80] record with the given
// item id and pocket, the minimal shape parseItemAt accepts.
func itemEntry(eid uint64, itemID, pocket uint32) []packet.IMessageElem {
	info := make([]byte, 80)
	le.PutUint32(info[0:], pocket)
	le.PutUint32(info[4:], itemID)
	return []packet.IMessageElem{
		packet.NewMessageElemLong(eid),
		packet.NewMessageElemByte(2),
		packet.NewMessageElemBin(info),
	}
}

// ownSnapshotPacket mirrors the 0x5209 head (byte, id, byte, name, "", "",
// race) followed by item records.
func ownSnapshotPacket(id uint64, entries ...[]packet.IMessageElem) *packet.GamePacket {
	msg := packet.Message{
		packet.NewMessageElemByte(1), packet.NewMessageElemLong(id), packet.NewMessageElemByte(0),
		packet.NewMessageElemString("我的角色"), packet.NewMessageElemString(""), packet.NewMessageElemString(""),
		packet.NewMessageElemInt(10001),
	}
	for _, e := range entries {
		msg = append(msg, e...)
	}
	return &packet.GamePacket{At: time.Now(), Op: packet.OpcodeChannelCharacterInfoR, Id: id, Msg: msg}
}

// newTestPublisher returns a publisher whose publish() buffers instead of
// flushing (lastSentAt fresh), so tests can inspect pendingEvents.
func newTestPublisher() *eventPublisher {
	return &eventPublisher{entityCache: make(entityCache), lastSentAt: time.Now()}
}

func ownerEquipmentEvents(p *eventPublisher) []*event.EventOwnerEquipment {
	var out []*event.EventOwnerEquipment
	for _, e := range p.pendingEvents {
		if oe, ok := e.(*event.EventOwnerEquipment); ok {
			out = append(out, oe)
		}
	}
	return out
}

func TestIndexItemFromInventory_MatchesStore(t *testing.T) {
	withTestItemDB(t)
	// Every mapped field gets a distinct non-zero value so a swapped field
	// mapping in indexItemFromInventory fails this test.
	it := packet.InventoryItem{
		EID: 77, ItemID: 16009, Qty: 1, Container: "equip", Pocket: 6,
		PosX: 3, PosY: 4,
		EnchantPrefix: 21203, EnchantSuffix: 30105,
		Durability: 8000, DurabilityMax: 8000, Defense: 1, Protection: 2,
		AttackMin: 201, AttackMax: 255, InjuryMin: 10, InjuryMax: 30,
		Balance: 60, Critical: 30, BagItemID: 5500008,
		Colors:        [6]uint32{0xB3946E},
		Metalware:     []packet.MetalwareEntry{{AbilityID: 4300106, Level: 8}},
		PrefixEffects: []packet.EnchantEffect{{Code: 1, Value: 20, CondSkill: 21001, CondRank: 6}},
		SuffixEffects: []packet.EnchantEffect{{Code: 16, Value: 5}},
		BlessEffects:  []packet.EnchantEffect{{Code: 3, Value: 15}},
		RelicEffects:  []packet.EnchantEffect{{Code: 178, Value: 7}},
		Metadata:      "MDEF:f:3.5;MPROT:f:1.2;",
	}
	meta := entityMeta{Id: 7, Name: "測試角色", RaceId: 10002}
	if err := itemDB.ReplaceStorage(meta, "inventory", []packet.InventoryItem{it}); err != nil {
		t.Fatal(err)
	}
	idx, err := itemDB.ReadIndex()
	if err != nil || len(idx) != 1 || len(idx[0].Items) != 1 {
		t.Fatalf("ReadIndex: %v %+v", err, idx)
	}
	got := indexItemFromInventory(it)
	if !reflect.DeepEqual(got, idx[0].Items[0]) {
		t.Fatalf("mismatch\n got=%+v\nwant=%+v", got, idx[0].Items[0])
	}
}

// TestEquipPockets_ExactSet pins the worn-slot set to the spec's 20 pockets;
// a swapped/added/dropped id here silently changes what the 裝備分析 tab shows.
func TestEquipPockets_ExactSet(t *testing.T) {
	want := []uint32{5, 6, 7, 8, 9, 10, 11, 13, 14, 16, 17, 32, 33, 34, 35, 51, 54, 62, 63, 64}
	if len(equipPockets) != len(want) {
		t.Fatalf("equipPockets has %d keys, want %d", len(equipPockets), len(want))
	}
	for _, k := range want {
		if !equipPockets[k] {
			t.Fatalf("pocket %d missing from equipPockets", k)
		}
	}
	for _, absent := range []uint32{12, 48, 90, 2, 2000} {
		if equipPockets[absent] {
			t.Fatalf("pocket %d must not be in equipPockets", absent)
		}
	}
}

func TestOwnerEquipmentLocked_FiltersAndSortsByPocket(t *testing.T) {
	p := newTestPublisher()
	p.setOwnerItemsLocked([]packet.InventoryItem{
		{EID: 1, ItemID: 100, Pocket: 8},
		{EID: 2, ItemID: 101, Pocket: 2}, // main inventory: excluded
		{EID: 3, ItemID: 102, Pocket: 5},
		{EID: 4, ItemID: 103, Pocket: 62},   // echo stone
		{EID: 5, ItemID: 104, Pocket: 2000}, // extra equipment set: excluded
	})
	worn := p.ownerEquipmentLocked()
	var pockets []uint32
	for _, it := range worn {
		pockets = append(pockets, it.Pocket)
	}
	if !reflect.DeepEqual(pockets, []uint32{5, 8, 62}) {
		t.Fatalf("pockets=%v want [5 8 62]", pockets)
	}
}

func TestHandleChannelCharacterInfo_SeedsOwnerEquipment(t *testing.T) {
	p := newTestPublisher()
	ownId := ownCharacterIdBase + 5
	p.ownerId = ownId // pre-seeded: tests snapshot seeding, not the owner-change transition
	p.handleChannelCharacterInfo(ownSnapshotPacket(ownId,
		itemEntry(1001, 16009, 6), // gloves, worn
		itemEntry(1002, 40005, 2), // sword in the bag
		itemEntry(1003, 18000, 8), // helmet, worn
	))

	if len(p.ownerItems) != 3 {
		t.Fatalf("ownerItems=%d want 3", len(p.ownerItems))
	}
	evs := ownerEquipmentEvents(p)
	if len(evs) != 1 {
		t.Fatalf("published %d EventOwnerEquipment, want 1", len(evs))
	}
	got := evs[0]
	if got.Id != "4503599627370501" { // ownCharacterIdBase+5 in decimal
		t.Fatalf("event id=%q", got.Id)
	}
	if len(got.Items) != 2 || got.Items[0].Pocket != 6 || got.Items[1].Pocket != 8 || got.Items[0].EID != "1001" {
		t.Fatalf("items=%+v", got.Items)
	}
	if got.Items[0].Item.(IndexItem).ID != 16009 {
		t.Fatalf("item=%+v", got.Items[0].Item)
	}
}

func TestHandleChannelCharacterInfo_EmptySnapshotKeepsItems(t *testing.T) {
	p := newTestPublisher()
	ownId := ownCharacterIdBase + 5
	p.ownerId = ownId // pre-seeded: tests snapshot seeding, not the owner-change transition
	p.handleChannelCharacterInfo(ownSnapshotPacket(ownId, itemEntry(1001, 16009, 6)))
	p.handleChannelCharacterInfo(ownSnapshotPacket(ownId))
	if len(p.ownerItems) != 1 {
		t.Fatalf("ownerItems=%d want 1 (empty snapshot must not wipe)", len(p.ownerItems))
	}
	if n := len(ownerEquipmentEvents(p)); n != 1 {
		t.Fatalf("published %d events, want 1", n)
	}
}

func TestHandleChannelCharacterInfo_IgnoresOtherEntities(t *testing.T) {
	p := newTestPublisher()
	p.handleChannelCharacterInfo(ownSnapshotPacket(12345, itemEntry(1001, 16009, 6))) // not in own-id block
	if p.ownerItems != nil {
		t.Fatalf("ownerItems=%v want nil", p.ownerItems)
	}
}

func TestSetOwnerCharacter_NewIdClearsOwnerItems(t *testing.T) {
	p := newTestPublisher()
	p.ownerId = 1
	p.ownerItems = map[uint64]packet.InventoryItem{9: {EID: 9, Pocket: 6}}
	p.setOwnerCharacter(2, "b")
	if p.ownerItems != nil {
		t.Fatal("ownerItems not cleared on owner change")
	}
	evs := ownerEquipmentEvents(p)
	if len(evs) != 1 || len(evs[0].Items) != 0 {
		t.Fatalf("owner change published %d EventOwnerEquipment, want exactly 1 with zero items: %+v", len(evs), evs)
	}

	p.ownerItems = map[uint64]packet.InventoryItem{9: {EID: 9}}
	p.setOwnerCharacter(2, "b") // same owner: keep
	if p.ownerItems == nil {
		t.Fatal("ownerItems cleared on a same-owner repeat")
	}
	if n := len(ownerEquipmentEvents(p)); n != 1 {
		t.Fatalf("same-owner repeat published an event: %d, want 1 (no new one)", n)
	}
}

func TestApplyOwnerItemLocked_ReplacesByEID(t *testing.T) {
	p := newTestPublisher()
	p.setOwnerItemsLocked([]packet.InventoryItem{{EID: 1, ItemID: 100, Pocket: 2}})
	if !p.applyOwnerItemLocked(packet.InventoryItem{EID: 1, ItemID: 100, Pocket: 5}) {
		t.Fatal("apply returned false for a known owner")
	}
	if p.ownerItems[1].Pocket != 5 {
		t.Fatalf("pocket=%d want 5", p.ownerItems[1].Pocket)
	}

	// Known EID replaced into the same unworn pocket: no worn-set change.
	p.setOwnerItemsLocked([]packet.InventoryItem{{EID: 3, ItemID: 100, Pocket: 2}})
	if p.applyOwnerItemLocked(packet.InventoryItem{EID: 3, ItemID: 100, Pocket: 2}) {
		t.Fatal("2->2 replace of a known item must not report a worn-set change")
	}

	// New EID landing in an unworn pocket: no change.
	if p.applyOwnerItemLocked(packet.InventoryItem{EID: 4, ItemID: 200, Pocket: 2}) {
		t.Fatal("new item landing in an unworn pocket must not report a worn-set change")
	}
	// New EID landing in a worn pocket: change.
	if !p.applyOwnerItemLocked(packet.InventoryItem{EID: 5, ItemID: 300, Pocket: 6}) {
		t.Fatal("new item landing in a worn pocket must report a worn-set change")
	}

	p.ownerItems = nil
	if p.applyOwnerItemLocked(packet.InventoryItem{EID: 2}) {
		t.Fatal("apply must be a no-op before any snapshot")
	}
}

// ownerItemMovePacket rebuilds a 0x59DE body (Task 2 research, 2026-09-05):
// (Long eid, Int from, Int to, Byte 2, Byte x, Byte y).
func ownerItemMovePacket(owner, eid uint64, from, to uint32, x, y uint8) *packet.GamePacket {
	msg := packet.Message{
		packet.NewMessageElemLong(eid),
		packet.NewMessageElemInt(from),
		packet.NewMessageElemInt(to),
		packet.NewMessageElemByte(2),
		packet.NewMessageElemByte(x),
		packet.NewMessageElemByte(y),
	}
	return &packet.GamePacket{At: time.Now(), Op: packet.OpcodeItemMove, Id: owner, Msg: msg}
}

// TestHandleOwnerItemMove_EquipAndUnequip replays three verbatim 0x59DE
// samples from the Task 2 research (capture C0): equip main hand (2631.087s),
// unequip a robe (6676.876s), then stow it with grid coords (6678.444s).
func TestHandleOwnerItemMove_EquipAndUnequip(t *testing.T) {
	const owner = 4503599630022047
	p := newTestPublisher()
	p.ownerId = owner
	p.setOwnerItemsLocked([]packet.InventoryItem{
		{EID: 22518904156276046, ItemID: 40745, Pocket: 101}, // sits in the bag; move's from=1 is the cursor, ignored
	})

	// 2631.087s: 1 -> 10, dropped onto the main-hand slot.
	p.handleOwnerItemMove(ownerItemMovePacket(owner, 22518904156276046, 1, 10, 0, 0))
	if it := p.ownerItems[22518904156276046]; it.Pocket != 10 || it.Container != "equip" {
		t.Fatalf("item=%+v want pocket=10 container=equip", it)
	}
	evs := ownerEquipmentEvents(p)
	if len(evs) != 1 {
		t.Fatalf("after equip: %d events, want 1", len(evs))
	}
	if len(evs[0].Items) != 1 || evs[0].Items[0].Pocket != 10 {
		t.Fatalf("event items=%+v", evs[0].Items)
	}

	// Another item, already worn in pocket 9 (long robe), seeded directly so
	// the sword's move above is not wiped by a fresh setOwnerItemsLocked.
	// Publish once to establish [sword@10, robe@9] as the dedupe baseline,
	// as a real snapshot/record event would have.
	p.ownerItems[22518904491263703] = packet.InventoryItem{EID: 22518904491263703, ItemID: 19003, Pocket: 9, Container: "equip"}
	p.publishOwnerEquipment(time.Now().Unix())
	if n := len(ownerEquipmentEvents(p)); n != 2 {
		t.Fatalf("after seeding the robe: %d events, want 2", n)
	}

	// 6676.876s: 9 -> 1, robe picked up off the body.
	p.handleOwnerItemMove(ownerItemMovePacket(owner, 22518904491263703, 9, 1, 0, 0))
	if it := p.ownerItems[22518904491263703]; it.Pocket != 1 {
		t.Fatalf("item=%+v want pocket=1", it)
	}
	evs = ownerEquipmentEvents(p)
	if len(evs) != 3 {
		t.Fatalf("after unequip: %d events, want 3", len(evs))
	}
	for _, it := range evs[2].Items {
		if it.Pocket == 9 {
			t.Fatalf("robe still worn in event: %+v", evs[2].Items)
		}
	}

	// 6678.444s: 1 -> 118, x=1 y=12, stowed back into the bag. Neither side
	// (cursor, bag pocket 118) is worn, so no fourth event.
	p.handleOwnerItemMove(ownerItemMovePacket(owner, 22518904491263703, 1, 118, 1, 12))
	it := p.ownerItems[22518904491263703]
	if it.Pocket != 118 || it.PosX != 1 || it.PosY != 12 {
		t.Fatalf("item=%+v want pocket=118 x=1 y=12", it)
	}
	if n := len(ownerEquipmentEvents(p)); n != 3 {
		t.Fatalf("stow into bag published an event: %d, want 3", n)
	}

	// Unknown EID: no event.
	p.handleOwnerItemMove(ownerItemMovePacket(owner, 99999, 2, 6, 0, 0))
	if n := len(ownerEquipmentEvents(p)); n != 3 {
		t.Fatalf("unknown EID published an event: %d, want 3", n)
	}

	// Non-owner frame id: nothing changes.
	p.handleOwnerItemMove(ownerItemMovePacket(7, 22518904156276046, 10, 6, 0, 0))
	if it := p.ownerItems[22518904156276046]; it.Pocket != 10 {
		t.Fatalf("non-owner move applied: item=%+v", it)
	}
	if n := len(ownerEquipmentEvents(p)); n != 3 {
		t.Fatalf("non-owner move published an event: %d, want 3", n)
	}
}

// ownerItemRecordPacket rebuilds the 11-element 0x59E0/0x5BD4 body from the
// Task 2 research (capture C0): full ItemRecord, bin80 verbatim from the sample.
func ownerItemRecordPacket(op packet.OpCode, owner, eid uint64, bin80, bin144 []byte, metadata string) *packet.GamePacket {
	msg := packet.Message{
		packet.NewMessageElemLong(eid),
		packet.NewMessageElemByte(2),
		packet.NewMessageElemBin(bin80),
		packet.NewMessageElemBin(bin144),
		packet.NewMessageElemString(metadata),
		packet.NewMessageElemString(""),
		packet.NewMessageElemByte(0),
		packet.NewMessageElemLong(0),
		packet.NewMessageElemByte(0),
		packet.NewMessageElemByte(0),
		packet.NewMessageElemLong(owner),
	}
	return &packet.GamePacket{At: time.Now(), Op: op, Id: owner, Msg: msg}
}

func TestHandleOwnerItemRecord_AddsAndReplaces(t *testing.T) {
	const owner = 4503599630022047
	// Bin(80)/Bin(144) hex from the 6671.731s 0x59E0 sample ([2]/[3]), decoded verbatim.
	bin80, err := hex.DecodeString("0a000000299f0000445f620037727f0037727f000000000052a3000068b0b600004f7d00000000000000000000000000000000000000390002000000000000000000000000000000000000000000ffff")
	if err != nil || len(bin80) != 80 {
		t.Fatalf("bin80 decode: %v len=%d", err, len(bin80))
	}
	bin144, err := hex.DecodeString("01f8784410270000e803000000000000983a0000983a0000983a000008000d00000014000a0a00000000000000000000000000000000050000000000000000000000794400000000ffffffff000000000000000000000000000004000000000000000000174f010000000000000000000000000000000000000000000000000000000000000000000000000000000000")
	if err != nil || len(bin144) != 144 {
		t.Fatalf("bin144 decode: %v len=%d", err, len(bin144))
	}

	p := newTestPublisher()
	p.ownerId = owner
	p.setOwnerItemsLocked([]packet.InventoryItem{{EID: 1, ItemID: 999, Pocket: 2}}) // unrelated seed item

	// First 0x59E0: item 40745 lands in pocket 10 (main hand, worn).
	rec := ownerItemRecordPacket(packet.OpcodeItemAdd, owner, 22518904156276046, bin80, bin144, "IMBSI:b:true;")
	p.handleOwnerItemRecord(rec)
	it, ok := p.ownerItems[22518904156276046]
	if !ok || it.Pocket != 10 || it.ItemID != 40745 || it.EID != 22518904156276046 {
		t.Fatalf("item=%+v ok=%v", it, ok)
	}
	// Colors[0] comes from bin80@8, well past the pocket/item-id fields, so
	// this proves the real sample bytes (not a synthesized buffer) were parsed.
	if it.Colors[0] != 0x625f44 {
		t.Fatalf("Colors[0]=%#x want 0x625f44", it.Colors[0])
	}
	if n := len(ownerEquipmentEvents(p)); n != 1 {
		t.Fatalf("after first record: %d events, want 1", n)
	}

	// Same body resent: replaced in place, still exactly one item with that EID.
	// The worn set is byte-identical to the last published one, so the dedupe
	// in publishOwnerEquipment must not republish it.
	p.handleOwnerItemRecord(rec)
	count := 0
	for eid := range p.ownerItems {
		if eid == 22518904156276046 {
			count++
		}
	}
	if count != 1 {
		t.Fatalf("EID duplicated: %d entries", count)
	}
	if n := len(ownerEquipmentEvents(p)); n != 1 {
		t.Fatalf("after resend: %d events, want 1 (byte-identical resend must not republish)", n)
	}

	// Same body via 0x5BD4's opcode alias: same handler path, still identical.
	rec5bd4 := ownerItemRecordPacket(packet.OpcodeItemRecordSingle, owner, 22518904156276046, bin80, bin144, "IMBSI:b:true;")
	p.handleOwnerItemRecord(rec5bd4)
	if n := len(ownerEquipmentEvents(p)); n != 1 {
		t.Fatalf("after OpcodeItemRecordSingle: %d events, want 1 (still identical)", n)
	}

	// 0x5BD4 sample for a new item entering the bag (bin80@0 = pocket 101,
	// item 19003): stored, but pocket 101 is unworn so no event.
	bin80b, err := hex.DecodeString("650000003b4a0000807c500088798e00db936900956ff40047acf50004a4bb001f15b1000000000000000000040000000800000000000000000000000000000000000000000000000000000000000000")
	if err != nil || len(bin80b) != 80 {
		t.Fatalf("bin80b decode: %v len=%d", err, len(bin80b))
	}
	bin144b, err := hex.DecodeString("0150c347ac0d000069020000000000005046000050460000504600000000000000000000000000000000000000000000000000000000000000000000000000000000c24700000000ffffffff000000000000000000000000000004000000000000000000174f010000000000000000000000000000000000000000000000000000000000000000000000000000000000")
	if err != nil || len(bin144b) != 144 {
		t.Fatalf("bin144b decode: %v len=%d", err, len(bin144b))
	}
	newBagRec := ownerItemRecordPacket(packet.OpcodeItemRecordSingle, owner, 22518904491263703, bin80b, bin144b, "")
	p.handleOwnerItemRecord(newBagRec)
	it2 := p.ownerItems[22518904491263703]
	if it2.Pocket != 101 || it2.ItemID != 19003 {
		t.Fatalf("item=%+v want pocket=101 itemID=19003", it2)
	}
	if it2.Colors[0] != 0x507c80 {
		t.Fatalf("Colors[0]=%#x want 0x507c80", it2.Colors[0])
	}
	if n := len(ownerEquipmentEvents(p)); n != 1 {
		t.Fatalf("new bag item published an event: %d, want 1", n)
	}

	// Before any snapshot: ignored, no event.
	p2 := newTestPublisher()
	p2.ownerId = owner
	p2.handleOwnerItemRecord(rec)
	if p2.ownerItems != nil {
		t.Fatalf("ownerItems seeded before any snapshot: %+v", p2.ownerItems)
	}
	if n := len(ownerEquipmentEvents(p2)); n != 0 {
		t.Fatalf("published before any snapshot: %d events, want 0", n)
	}
}

// TestPublishOwnerEquipment_DedupeThenRealChangeStillPublishes covers the
// controller ruling: a dedupe-suppressed resend must not wedge the dedupe
// state so a genuine later change stops publishing.
func TestPublishOwnerEquipment_DedupeThenRealChangeStillPublishes(t *testing.T) {
	p := newTestPublisher()
	ownId := ownCharacterIdBase + 5
	p.ownerId = ownId
	p.setOwnerItemsLocked([]packet.InventoryItem{{EID: 1, ItemID: 16009, Pocket: 6, Container: "equip"}})

	p.publishOwnerEquipment(1)
	if n := len(ownerEquipmentEvents(p)); n != 1 {
		t.Fatalf("initial publish: %d events, want 1", n)
	}

	// Identical resend: suppressed by dedupe.
	p.publishOwnerEquipment(2)
	if n := len(ownerEquipmentEvents(p)); n != 1 {
		t.Fatalf("identical resend republished: %d events, want 1", n)
	}

	// Move the worn item to a different worn pocket: a genuine change must
	// still publish despite the prior dedupe-suppressed resend.
	if !p.moveOwnerItemLocked(1, 8, 0, 0) {
		t.Fatal("moveOwnerItemLocked reported no change")
	}
	p.publishOwnerEquipment(3)
	evs := ownerEquipmentEvents(p)
	if len(evs) != 2 {
		t.Fatalf("after real change: %d events, want 2", len(evs))
	}
	if len(evs[1].Items) != 1 || evs[1].Items[0].Pocket != 8 {
		t.Fatalf("last event items=%+v want pocket 8", evs[1].Items)
	}
}

// TestHandleOwnerItemRecord_IgnoresForeignBody verifies a foreign-owner
// packet is neither parsed nor applied, even when its body is malformed
// (would otherwise trip the "unrecognised ItemRecord body" log).
func TestHandleOwnerItemRecord_IgnoresForeignBody(t *testing.T) {
	const owner = 4503599630022047
	p := newTestPublisher()
	p.ownerId = owner
	p.setOwnerItemsLocked(nil)

	garbled := &packet.GamePacket{At: time.Now(), Op: packet.OpcodeItemAdd, Id: owner + 1, Msg: packet.Message{}}
	p.handleOwnerItemRecord(garbled)
	if len(p.ownerItems) != 0 {
		t.Fatalf("foreign body applied: ownerItems=%+v", p.ownerItems)
	}
	if n := len(ownerEquipmentEvents(p)); n != 0 {
		t.Fatalf("foreign body published an event: %d, want 0", n)
	}
}

func TestSnapshotEvents_IncludesOwnerEquipment(t *testing.T) {
	p := newTestPublisher()
	p.ownerId = 42
	p.ownerName = "我"
	p.setOwnerItemsLocked([]packet.InventoryItem{{EID: 1, ItemID: 100, Pocket: 5}})
	var found bool
	for _, e := range p.snapshotEvents(false) {
		if oe, ok := e.(*event.EventOwnerEquipment); ok && len(oe.Items) == 1 {
			found = true
		}
	}
	if !found {
		t.Fatal("initial batch lacks EventOwnerEquipment")
	}
}

// statPacket builds a 0x7530/0x7532 delta: (byte, int count) then
// count x (int id, int value).
func statPacket(id uint64, op packet.OpCode, pairs ...uint32) *packet.GamePacket {
	msg := packet.Message{packet.NewMessageElemByte(0), packet.NewMessageElemInt(uint32(len(pairs) / 2))}
	for i := 0; i+1 < len(pairs); i += 2 {
		msg = append(msg, packet.NewMessageElemInt(pairs[i]), packet.NewMessageElemInt(pairs[i+1]))
	}
	return &packet.GamePacket{At: time.Now(), Op: op, Id: id, Msg: msg}
}

func ownerStatsEvents(p *eventPublisher) []*event.EventOwnerStats {
	var out []*event.EventOwnerStats
	for _, e := range p.pendingEvents {
		if se, ok := e.(*event.EventOwnerStats); ok {
			out = append(out, se)
		}
	}
	return out
}

func TestHandleStatTable_PublishesOwnerStatsOnlyOnChange(t *testing.T) {
	p := newTestPublisher()
	p.ownerId = 42
	str := uint32(packet.StatStr)

	p.handleStatTable(statPacket(42, packet.OpcodeStatUpdatePrivate, str, 30))
	if n := len(ownerStatsEvents(p)); n != 1 {
		t.Fatalf("after first delta: %d events, want 1", n)
	}
	p.handleStatTable(statPacket(42, packet.OpcodeStatUpdatePrivate, str, 30))
	if n := len(ownerStatsEvents(p)); n != 1 {
		t.Fatalf("unchanged delta republished: %d", n)
	}
	p.handleStatTable(statPacket(42, packet.OpcodeStatUpdatePrivate, str, 31))
	if n := len(ownerStatsEvents(p)); n != 2 {
		t.Fatalf("changed delta not published: %d", n)
	}
	p.handleStatTable(statPacket(7, packet.OpcodeStatUpdatePublic, uint32(packet.StatLife), 100))
	if n := len(ownerStatsEvents(p)); n != 2 {
		t.Fatalf("non-owner delta published: %d", n)
	}
	evs := ownerStatsEvents(p)
	if got := evs[len(evs)-1].Panel.Str; got != 31 {
		t.Fatalf("Str=%v want 31", got)
	}
}

// TestHandleStatTable_ThrottlesCurrentValuesOnly covers the controller
// ruling: Life/Mana/Stamina-only changes publish at most once per second,
// but any other field change publishes immediately regardless of timing.
func TestHandleStatTable_ThrottlesCurrentValuesOnly(t *testing.T) {
	p := newTestPublisher()
	p.ownerId = 42

	pk1 := statPacket(42, packet.OpcodeStatUpdatePrivate, uint32(packet.StatLife), 50)
	pk1.At = time.Unix(1000, 0)
	p.handleStatTable(pk1)
	if n := len(ownerStatsEvents(p)); n != 1 {
		t.Fatalf("after first Life delta: %d events, want 1", n)
	}

	pk2 := statPacket(42, packet.OpcodeStatUpdatePrivate, uint32(packet.StatLife), 60)
	pk2.At = time.Unix(1000, 0)
	p.handleStatTable(pk2)
	if n := len(ownerStatsEvents(p)); n != 1 {
		t.Fatalf("Life change in same second republished: %d, want 1", n)
	}

	pk3 := statPacket(42, packet.OpcodeStatUpdatePrivate, uint32(packet.StatLife), 70)
	pk3.At = time.Unix(1001, 0)
	p.handleStatTable(pk3)
	if n := len(ownerStatsEvents(p)); n != 2 {
		t.Fatalf("Life change a second later not published: %d, want 2", n)
	}

	pk4 := statPacket(42, packet.OpcodeStatUpdatePrivate, uint32(packet.StatStr), 31)
	pk4.At = time.Unix(1001, 0)
	p.handleStatTable(pk4)
	if n := len(ownerStatsEvents(p)); n != 3 {
		t.Fatalf("Str change in the same second as prior publish not immediate: %d, want 3", n)
	}
}

func TestPanel_LifeMaxMod(t *testing.T) {
	st := packet.StatTable{packet.StatLifeMaxBase: 100, packet.StatLifeMaxMod: 25}
	pn := st.Panel()
	if pn.LifeMax != 125 || pn.LifeMaxMod != 25 {
		t.Fatalf("LifeMax=%v LifeMaxMod=%v want 125 / 25", pn.LifeMax, pn.LifeMaxMod)
	}
}

func TestSnapshotEvents_IncludesOwnerStats(t *testing.T) {
	p := newTestPublisher()
	p.ownerId = 42
	p.ownerName = "我"
	p.statTables = map[uint64]packet.StatTable{42: {packet.StatLevel: 200}}
	var found bool
	for _, e := range p.snapshotEvents(false) {
		if se, ok := e.(*event.EventOwnerStats); ok && se.Panel.Level == 200 {
			found = true
		}
	}
	if !found {
		t.Fatal("initial batch lacks EventOwnerStats")
	}
}

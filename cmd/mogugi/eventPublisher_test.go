package main

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

// packetFixtureMessage reads a lib/packet testdata fixture's raw_message_hex
// and decodes it into a Message, for building test GamePackets in this package.
func packetFixtureMessage(t *testing.T, name string) (packet.Message, error) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "lib", "packet", "testdata", name))
	if err != nil {
		return nil, err
	}
	var fx struct {
		RawMessageHex string `json:"raw_message_hex"`
	}
	if err := json.Unmarshal(b, &fx); err != nil {
		return nil, err
	}
	raw, err := hex.DecodeString(fx.RawMessageHex)
	if err != nil {
		return nil, err
	}
	return packet.NewMessage(bytes.NewReader(raw))
}

// Marionettes and other summons send a 0x5209 snapshot like any owned entity,
// but they carry no real inventory and would flood items_log with one file per
// summon (named after the raw entity id).
func TestIsSummonRace(t *testing.T) {
	summons := []uint32{
		990104, // 小丑人偶
		990125, // 墮落者的小丑人偶
		990204, // 巨像人偶
		990216, // 巨人型 (tw-159)
		990028, // 地獄犬
	}
	keep := []uint32{
		10001, 10002, // player characters
		490359, // 紅炎的精靈龍 (pet)
		490290, // cart pet
		440516, // partner
		0,      // unknown (head not parseable) — must not be filtered
	}

	for _, r := range summons {
		if !isSummonRace(r) {
			t.Errorf("isSummonRace(%d) = false, want true", r)
		}
	}
	for _, r := range keep {
		if isSummonRace(r) {
			t.Errorf("isSummonRace(%d) = true, want false", r)
		}
	}
}

func TestShouldStoreSnapshot(t *testing.T) {
	ok := &packet.EntitySnapshot{Id: 1 << 52, RaceId: 10002, Name: "角色"}
	if !shouldStoreSnapshot(ok) {
		t.Error("player char must pass")
	}
	pet := &packet.EntitySnapshot{Id: (1 << 52) + (1 << 40), RaceId: 490359, Name: "寵"}
	if !shouldStoreSnapshot(pet) {
		t.Error("own pet must pass")
	}
	for _, bad := range []*packet.EntitySnapshot{
		{Id: 1 << 52, RaceId: 990125, Name: "人偶"},
		{Id: 1 << 52, RaceId: 33022, Name: "0:3G5PF"},
		{Id: 1 << 52, RaceId: 805125, Name: "活動"},
		{Id: 1 << 52, RaceId: 10002, Name: ""},
		{Id: 4767482420171028, RaceId: 8002, Name: "展示複本"},
		{Id: 0, RaceId: 10002, Name: "壞頭"},
	} {
		if shouldStoreSnapshot(bad) {
			t.Errorf("must reject %+v", bad)
		}
	}
}

// beautyRoomPacket builds a minimal 0x96CA GamePacket: header + one item.
func beautyRoomPacket(targetId uint64) *packet.GamePacket {
	info := make([]byte, 80)
	le.PutUint32(info[4:], 12001)
	return &packet.GamePacket{
		At: time.Now(),
		Op: packet.OpcodeBeautyRoomList,
		Id: targetId,
		Msg: packet.Message{
			packet.NewMessageElemByte(1),
			packet.NewMessageElemString("xxxxxxxxxxxxxxxxxxxx"),
			packet.NewMessageElemInt(1),
			packet.NewMessageElemLong(0),
			packet.NewMessageElemLong(22518902041861562),
			packet.NewMessageElemByte(2),
			packet.NewMessageElemBin(info),
			packet.NewMessageElemBin(make([]byte, 144)),
			packet.NewMessageElemString(""),
			packet.NewMessageElemString(""),
		},
	}
}

// channelCharacterInfoPacket builds a minimal 0x5209 GamePacket: head shape
// mirrors entity-appear (byte, id, byte, name, "", "", race), plus one item.
func channelCharacterInfoPacket(id uint64, raceId uint32, name string) *packet.GamePacket {
	info := make([]byte, 80)
	le.PutUint32(info[4:], 12001)
	return &packet.GamePacket{
		At: time.Now(),
		Op: packet.OpcodeChannelCharacterInfoR,
		Id: id,
		Msg: packet.Message{
			packet.NewMessageElemByte(1),
			packet.NewMessageElemLong(id),
			packet.NewMessageElemByte(0),
			packet.NewMessageElemString(name),
			packet.NewMessageElemString(""),
			packet.NewMessageElemString(""),
			packet.NewMessageElemInt(raceId),
			packet.NewMessageElemLong(999),
			packet.NewMessageElemByte(2),
			packet.NewMessageElemBin(info),
		},
	}
}

// channelCharacterInfoPacketNoItems is the same head shape with no item run,
// used to exercise the empty-snapshot guard.
func channelCharacterInfoPacketNoItems(id uint64, raceId uint32, name string) *packet.GamePacket {
	return &packet.GamePacket{
		At: time.Now(),
		Op: packet.OpcodeChannelCharacterInfoR,
		Id: id,
		Msg: packet.Message{
			packet.NewMessageElemByte(1),
			packet.NewMessageElemLong(id),
			packet.NewMessageElemByte(0),
			packet.NewMessageElemString(name),
			packet.NewMessageElemString(""),
			packet.NewMessageElemString(""),
			packet.NewMessageElemInt(raceId),
		},
	}
}

// withTestItemDB opens a temp-dir item store, installs it as the package
// global for the test's duration, and restores the previous value after.
func withTestItemDB(t *testing.T) *itemStore {
	t.Helper()
	db, err := openItemStore(filepath.Join(t.TempDir(), "items.db"))
	if err != nil {
		t.Fatal(err)
	}
	orig := itemDB
	itemDB = db
	t.Cleanup(func() {
		db.Close()
		itemDB = orig
	})
	return db
}

func TestHandleBeautyRoomWritesStore(t *testing.T) {
	withTestItemDB(t)

	p := &eventPublisher{entityCache: make(entityCache)}
	p.entityCache[7] = &entityInfoExtend{EntityInfo: &packet.EntityInfo{Id: 7, Name: "測試角色", RaceId: 10002}}

	p.handleBeautyRoom(beautyRoomPacket(7))

	n, err := itemDB.CountItems(7, "beauty")
	if err != nil || n != 1 {
		t.Fatalf("CountItems(beauty) = %d, %v, want 1", n, err)
	}
	idx, err := itemDB.ReadIndex()
	if err != nil || len(idx) != 1 {
		t.Fatalf("ReadIndex: %v, %d entities", err, len(idx))
	}
	if idx[0].Entity != "測試角色" {
		t.Errorf("entity = %q, want 測試角色", idx[0].Entity)
	}
	if len(idx[0].Items) != 1 || idx[0].Items[0].Storage != "beauty" || idx[0].Items[0].ID != 12001 {
		t.Errorf("items = %+v", idx[0].Items)
	}
}

// Real-world case (capture 1784996977): mogugi starts mid-session, so the
// character never sends an appear packet and entityCache misses it — but
// its 0x5209 snapshot did arrive and carries the id→name mapping.
func TestHandleBeautyRoomOwnerFromSnapshotName(t *testing.T) {
	withTestItemDB(t)

	p := &eventPublisher{entityCache: make(entityCache)}
	p.rememberSnapshotName(7, "地獄哞菇")
	p.handleBeautyRoom(beautyRoomPacket(7))

	idx, err := itemDB.ReadIndex()
	if err != nil || len(idx) != 1 || idx[0].Entity != "地獄哞菇" {
		t.Fatalf("got %+v, %v, want entity 地獄哞菇 via snapshot-name fallback", idx, err)
	}
}

func TestHandleBeautyRoomSkipsUnknownOwner(t *testing.T) {
	withTestItemDB(t)

	p := &eventPublisher{entityCache: make(entityCache)}
	p.handleBeautyRoom(beautyRoomPacket(7)) // id 7 not in cache

	idx, _ := itemDB.ReadIndex()
	if len(idx) != 0 {
		t.Errorf("expected no entities, got %d", len(idx))
	}
}

func TestHandleBeautyRoomEmptyParseDoesNotWrite(t *testing.T) {
	withTestItemDB(t)

	p := &eventPublisher{entityCache: make(entityCache)}
	p.entityCache[7] = &entityInfoExtend{EntityInfo: &packet.EntityInfo{Id: 7, Name: "測試角色"}}

	// Header declares 39 items but carries no item records.
	pk := &packet.GamePacket{
		At: time.Now(),
		Op: packet.OpcodeBeautyRoomList,
		Id: 7,
		Msg: packet.Message{
			packet.NewMessageElemByte(1),
			packet.NewMessageElemString("xxxxxxxxxxxxxxxxxxxx"),
			packet.NewMessageElemInt(39),
			packet.NewMessageElemLong(0),
		},
	}
	p.handleBeautyRoom(pk)

	idx, _ := itemDB.ReadIndex()
	if len(idx) != 0 {
		t.Errorf("expected no entities after empty parse, got %d", len(idx))
	}
}

func TestHandleChannelCharacterInfoWritesStore(t *testing.T) {
	withTestItemDB(t)

	p := &eventPublisher{entityCache: make(entityCache)}
	p.handleChannelCharacterInfo(channelCharacterInfoPacket(1<<52, 10002, "測試角色"))

	n, err := itemDB.CountItems(int64(1<<52), "inventory")
	if err != nil || n != 1 {
		t.Fatalf("CountItems(inventory) = %d, %v, want 1", n, err)
	}
	idx, err := itemDB.ReadIndex()
	if err != nil || len(idx) != 1 || idx[0].Entity != "測試角色" {
		t.Fatalf("got %+v, %v", idx, err)
	}
}

func TestHandleChannelCharacterInfoFiltersSummonRace(t *testing.T) {
	withTestItemDB(t)

	p := &eventPublisher{entityCache: make(entityCache)}
	p.handleChannelCharacterInfo(channelCharacterInfoPacket(1<<52, 990125, "人偶"))

	idx, _ := itemDB.ReadIndex()
	if len(idx) != 0 {
		t.Errorf("expected summon race to be filtered, got %d entities", len(idx))
	}
}

func TestHandleChannelCharacterInfoEmptySnapshotGuard(t *testing.T) {
	withTestItemDB(t)

	p := &eventPublisher{entityCache: make(entityCache)}
	// First snapshot seeds one item.
	p.handleChannelCharacterInfo(channelCharacterInfoPacket(1<<52, 10002, "測試角色"))
	// Second snapshot with no items must NOT wipe the existing inventory.
	p.handleChannelCharacterInfo(channelCharacterInfoPacketNoItems(1<<52, 10002, "測試角色"))

	n, err := itemDB.CountItems(int64(1<<52), "inventory")
	if err != nil || n != 1 {
		t.Fatalf("CountItems after empty snapshot = %d, %v, want 1 (kept)", n, err)
	}
}

func TestHandleBankListWritesTabs(t *testing.T) {
	origDB := itemDB
	db, _ := openItemStore(filepath.Join(t.TempDir(), "items.db"))
	itemDB = db
	defer func() { db.Close(); itemDB = origDB }()

	p := &eventPublisher{entityCache: make(entityCache)}
	msg, _ := packetFixtureMessage(t, "0x7212_page1.json")
	p.handleBankList(&packet.GamePacket{At: time.Now(), Op: packet.OpcodeBankList, Id: 7, Msg: msg})

	b, _ := packet.ParseBankListPacket(msg)
	acctId := bankEntityId(b.Account)
	n, _ := itemDB.CountItems(acctId, "bank")
	if n != 62 { // 25 + 37 + 0
		t.Fatalf("bank items = %d, want 62", n)
	}
}

// emptyAccountBankPacket builds a minimal 0x7212 header (9 elements, zero
// tabs) with an empty account string, to exercise the empty-account guard.
func emptyAccountBankPacket() *packet.GamePacket {
	return &packet.GamePacket{
		At: time.Now(),
		Op: packet.OpcodeBankList,
		Id: 7,
		Msg: packet.Message{
			packet.NewMessageElemByte(1),
			packet.NewMessageElemByte(0),
			packet.NewMessageElemLong(0),
			packet.NewMessageElemByte(0),
			packet.NewMessageElemString(""),
			packet.NewMessageElemString(""),
			packet.NewMessageElemString(""),
			packet.NewMessageElemLong(0),
			packet.NewMessageElemInt(0),
		},
	}
}

func TestHandleBankListEmptyAccountSkipped(t *testing.T) {
	withTestItemDB(t)

	p := &eventPublisher{entityCache: make(entityCache)}
	p.handleBankList(emptyAccountBankPacket())

	idx, _ := itemDB.ReadIndex()
	if len(idx) != 0 {
		t.Errorf("expected no entities for empty account, got %d", len(idx))
	}
}

// TestHandleBankListTwoPages replays both bank pages (now page-uniquely
// masked, see bank_test.go) through the same account and checks the two
// pages don't clobber each other's tabs via a shared bag_name.
func TestHandleBankListTwoPages(t *testing.T) {
	withTestItemDB(t)

	p := &eventPublisher{entityCache: make(entityCache)}
	msg0, _ := packetFixtureMessage(t, "0x7212_page0.json")
	p.handleBankList(&packet.GamePacket{At: time.Now(), Op: packet.OpcodeBankList, Id: 7, Msg: msg0})
	msg1, _ := packetFixtureMessage(t, "0x7212_page1.json")
	p.handleBankList(&packet.GamePacket{At: time.Now(), Op: packet.OpcodeBankList, Id: 7, Msg: msg1})

	b, _ := packet.ParseBankListPacket(msg0)
	acctId := bankEntityId(b.Account)
	n, err := itemDB.CountItems(acctId, "bank")
	if err != nil || n != 136 { // 74 (page0) + 62 (page1)
		t.Fatalf("bank items = %d, %v, want 136", n, err)
	}

	idx, err := itemDB.ReadIndex()
	if err != nil || len(idx) != 1 {
		t.Fatalf("ReadIndex: %v, %d entities", err, len(idx))
	}
	bags := map[string]bool{}
	for _, it := range idx[0].Items {
		bags[it.BagName] = true
	}
	// 4 page0 tabs + 3 page1 tabs, minus p1tab2 which is genuinely empty
	// (0 items) and so contributes no item row / bag_name at all.
	if len(bags) != 6 {
		t.Errorf("distinct bagName values = %d, want 6 (page-unique tab names)", len(bags))
	}
}

// setOwnerCharacter must dedupe repeat calls (no re-publish) and its value
// must surface in snapshotEvents() for new WS clients.
func TestSetOwnerCharacter(t *testing.T) {
	// lastSentAt fresh so publish() doesn't auto-flush pendingEvents away.
	p := &eventPublisher{entityCache: make(entityCache), lastSentAt: time.Now()}

	p.setOwnerCharacter(1<<52|5, "測試角色")
	p.Lock()
	n := len(p.pendingEvents)
	p.Unlock()
	if n != 1 {
		t.Fatalf("pendingEvents after first call = %d, want 1", n)
	}

	p.setOwnerCharacter(1<<52|5, "測試角色")
	p.Lock()
	n = len(p.pendingEvents)
	p.Unlock()
	if n != 1 {
		t.Fatalf("pendingEvents after repeat call = %d, want 1 (deduped)", n)
	}

	found := false
	for _, ev := range p.snapshotEvents() {
		if oc, ok := ev.(*event.EventOwnerCharacter); ok && oc.Name == "測試角色" {
			found = true
		}
	}
	if !found {
		t.Error("snapshotEvents() missing EventOwnerCharacter with owner name")
	}
}

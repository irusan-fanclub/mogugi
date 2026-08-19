package main

import (
	"bytes"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
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

// questInfoPacket builds a 0x8CA0 quest-journal packet as captured live:
// [0]int flags, [1]long, [2]byte, [3]long, [4]byte kind, [5]int missionId,
// [6]string display name (capture 1784960230, 布里萊赫 entry).
func questInfoPacket(kind uint8, missionId uint32, name string) *packet.GamePacket {
	return &packet.GamePacket{
		At: time.Now(),
		Op: packet.OpcodeQuestInfo,
		Id: 1,
		Msg: packet.Message{
			packet.NewMessageElemInt(0xFFFFFFFF),
			packet.NewMessageElemLong(27022503738212886),
			packet.NewMessageElemByte(0),
			packet.NewMessageElemLong(22518904110842390),
			packet.NewMessageElemByte(kind),
			packet.NewMessageElemInt(missionId),
			packet.NewMessageElemString(name),
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

func setLocationPacket(id uint64, region uint32) *packet.GamePacket {
	return &packet.GamePacket{
		At: time.Now(),
		Op: packet.OpcodeSetLocation,
		Id: id,
		Msg: packet.Message{
			packet.NewMessageElemByte(1),
			packet.NewMessageElemInt(region),
			packet.NewMessageElemInt(100),
			packet.NewMessageElemInt(200),
		},
	}
}

// dynRegionFixture is one entry of a 0xA9A0 dynamic-region table.
type dynRegionFixture struct {
	id       uint32
	baseId   uint32
	baseName string
}

// dynamicRegionInfoPacket builds a 0xA9A0 in the shape captured on 2026-07-29
// (喀輪巴斯, 2 entries) and 2026-07-27 (布里萊赫, 3 entries).
func dynamicRegionInfoPacket(warpTo uint32, entries ...dynRegionFixture) *packet.GamePacket {
	msg := packet.Message{
		packet.NewMessageElemLong(4503599630022047), // creature entity id
		packet.NewMessageElemInt(4016),              // warp-from region
		packet.NewMessageElemInt(warpTo),            // warp-to (dynamic) region
		packet.NewMessageElemInt(40000),             // x
		packet.NewMessageElemInt(38416),             // y
		packet.NewMessageElemInt(16),                // unknown, 16 in every sample
		packet.NewMessageElemInt(uint32(len(entries))),
	}
	for _, e := range entries {
		msg = append(msg,
			packet.NewMessageElemInt(e.id),
			packet.NewMessageElemString(fmt.Sprintf("DynamicRegion%d", e.id)),
			packet.NewMessageElemInt(0x80000001),
			packet.NewMessageElemInt(e.baseId),
			packet.NewMessageElemString(e.baseName),
			packet.NewMessageElemInt(200),
			packet.NewMessageElemByte(0),
			packet.NewMessageElemString("data/world/"+e.baseName+"/region_variation_715500.xml"),
			packet.NewMessageElemByte(1),
		)
	}
	return &packet.GamePacket{
		At:  time.Now(),
		Op:  packet.OpcodeDynamicRegionList,
		Id:  3458764513820540928,
		Msg: msg,
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

// The raw account id must never reach the database.
func TestHandleBeautyRoomStoresHashedAccount(t *testing.T) {
	withTestItemDB(t)

	p := &eventPublisher{entityCache: make(entityCache)}
	p.entityCache[7] = &entityInfoExtend{EntityInfo: &packet.EntityInfo{Id: 7, Name: "測試角色", RaceId: 10002}}

	pk := beautyRoomPacket(7)
	p.handleBeautyRoom(pk)

	_, _, account, err := packet.ParseBeautyRoomPacket(pk.Msg)
	if err != nil || account == "" {
		t.Fatalf("fixture account = %q, %v, want non-empty", account, err)
	}

	var stored string
	if err := itemDB.db.QueryRow(`SELECT account FROM entities WHERE id=?`, int64(7)).
		Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if stored == account {
		t.Fatal("raw account id was written to the database")
	}
	if stored != accountHash(account) {
		t.Fatalf("stored account = %q, want %q", stored, accountHash(account))
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
	for _, ev := range p.snapshotEvents(false) {
		if oc, ok := ev.(*event.EventOwnerCharacter); ok && oc.Name == "測試角色" {
			found = true
		}
	}
	if !found {
		t.Error("snapshotEvents() missing EventOwnerCharacter with owner name")
	}
}

// The 45004 mission-start packet stopped arriving after the 2026-07-23 game
// update; the quest-journal 0x8CA0 (kind 7) is now the mission-id source.
func TestHandleQuestInfoRecordsMission(t *testing.T) {
	p := &eventPublisher{entityCache: make(entityCache)}

	p.handleQuestInfo(questInfoPacket(7, 717000, "布里萊赫"))
	if p.lastMissionID != 717000 {
		t.Errorf("lastMissionID = %d, want 717000", p.lastMissionID)
	}
	if p.lastMissionName != "布里萊赫" {
		t.Errorf("lastMissionName = %q, want 布里萊赫", p.lastMissionName)
	}
}

// A dungeon absent from the dungeonNames table still gets named, via the
// display name carried by the quest-info packet.
func TestRegionNameFallsBackToQuestInfoName(t *testing.T) {
	p := &eventPublisher{entityCache: make(entityCache)}

	p.handleQuestInfo(questInfoPacket(7, 999999, "新副本"))
	if got := p.regionName(35001); got != "副本:新副本" {
		t.Errorf("regionName = %q, want 副本:新副本", got)
	}
}

func TestHandleQuestInfoIgnoresOtherQuestKinds(t *testing.T) {
	p := &eventPublisher{entityCache: make(entityCache)}

	p.handleQuestInfo(questInfoPacket(13, 1378, "每日任務"))
	if p.lastMissionID != 0 {
		t.Errorf("lastMissionID = %d, want 0", p.lastMissionID)
	}
}

// End-to-end for the file-split feature: quest info then a dynamic-region
// 26009 must open the per-run dungeon file; leaving must close it.
func TestDungeonLogOpensFromQuestInfo(t *testing.T) {
	orig := dungeonLogDirPath
	dungeonLogDirPath = t.TempDir()
	defer func() { dungeonLogDirPath = orig }()

	p := &eventPublisher{entityCache: make(entityCache)}

	p.handleQuestInfo(questInfoPacket(7, 717000, "布里萊赫"))
	p.handleSetLocation(setLocationPacket(1, 35001))
	if !p.dgnLog.IsOpen() {
		t.Fatal("dungeon log not open after quest info + dynamic-region entry")
	}

	p.handleSetLocation(setLocationPacket(1, 3100))
	if p.dgnLog.IsOpen() {
		t.Fatal("dungeon log still open after leaving the dungeon")
	}
	if p.lastMissionID != 0 || p.lastMissionName != "" {
		t.Error("mission id/name not cleared after leaving the dungeon")
	}
}

// 0xA9A0 carries the whole dynamic-region table of a dungeon instance, so a
// map change into any of its regions can name the static region it clones.
func TestRegionBaseSuffixFromDynamicRegionList(t *testing.T) {
	p := &eventPublisher{entityCache: make(entityCache)}

	p.handleDynamicRegionList(dynamicRegionInfoPacket(35012,
		dynRegionFixture{35012, 4022, "NTD_dungeon"},
		dynRegionFixture{35031, 4016, "TR_main_field_01"},
	))

	if got, want := p.regionBaseSuffix(35012), ", base=NTD_dungeon(4022)"; got != want {
		t.Errorf("regionBaseSuffix(35012) = %q, want %q", got, want)
	}
	if got, want := p.regionBaseSuffix(35031), ", base=TR_main_field_01(4016)"; got != want {
		t.Errorf("regionBaseSuffix(35031) = %q, want %q", got, want)
	}
	if got := p.regionBaseSuffix(35099); got != "" {
		t.Errorf("regionBaseSuffix(unlisted) = %q, want empty", got)
	}
}

// The entry count is a real field, not a fixed 2: 布里萊赫 lists three stages.
func TestDynamicRegionListReadsEveryEntry(t *testing.T) {
	p := &eventPublisher{entityCache: make(entityCache)}

	p.handleDynamicRegionList(dynamicRegionInfoPacket(35032,
		dynRegionFixture{35032, 4062, "MRD_1S"},
		dynRegionFixture{35033, 4063, "MRD_2S"},
		dynRegionFixture{35034, 4064, "MRD_3S"},
	))

	for region, want := range map[uint32]string{
		35032: ", base=MRD_1S(4062)",
		35033: ", base=MRD_2S(4063)",
		35034: ", base=MRD_3S(4064)",
	} {
		if got := p.regionBaseSuffix(region); got != want {
			t.Errorf("regionBaseSuffix(%d) = %q, want %q", region, got, want)
		}
	}
}

// Dynamic ids are recycled across runs, so a table left over from the last
// dungeon must not annotate the next one if its 0xA9A0 was missed.
func TestDynamicRegionListClearedOnLeavingDungeon(t *testing.T) {
	p := &eventPublisher{entityCache: make(entityCache)}

	p.handleDynamicRegionList(dynamicRegionInfoPacket(35012,
		dynRegionFixture{35012, 4022, "NTD_dungeon"},
	))
	p.handleSetLocation(setLocationPacket(1, 35012))
	p.handleSetLocation(setLocationPacket(1, 4016))

	if got := p.regionBaseSuffix(35012); got != "" {
		t.Errorf("regionBaseSuffix after leaving = %q, want empty", got)
	}
}

// The base-region annotation belongs inside the (region=…) parens, so a
// dungeon line still reads as one location.
func TestMapChangeLine(t *testing.T) {
	got := mapChangeLine("副本:喀輪巴斯", 35031, ", base=TR_main_field_01(4016)", " mission=#715500", "副本:喀輪巴斯")
	want := "map change: 副本:喀輪巴斯 (region=35031, base=TR_main_field_01(4016)) mission=#715500 from 副本:喀輪巴斯"
	if got != want {
		t.Errorf("mapChangeLine =\n %q\nwant\n %q", got, want)
	}

	got = mapChangeLine("托利峽谷", 4016, "", "", "")
	want = "map change: 托利峽谷 (region=4016)"
	if got != want {
		t.Errorf("mapChangeLine (static, no previous) =\n %q\nwant\n %q", got, want)
	}
}

// statSnapshotPacket builds a 0x5209 whose stat block starts at element 30
// (stat 26); element [1] is the entity the snapshot belongs to.
func statSnapshotPacket(id uint64, stats ...packet.IMessageElem) *packet.GamePacket {
	msg := make(packet.Message, 30)
	for i := range msg {
		msg[i] = packet.NewMessageElemInt(0)
	}
	msg[1] = packet.NewMessageElemLong(id)
	return &packet.GamePacket{
		At: time.Now(), Op: packet.OpcodeChannelCharacterInfoR, Id: 1,
		Msg: append(msg, stats...),
	}
}

func statDeltaPacket(id uint64, pairs ...packet.IMessageElem) *packet.GamePacket {
	msg := packet.Message{packet.NewMessageElemByte(3), packet.NewMessageElemInt(uint32(len(pairs) / 2))}
	return &packet.GamePacket{
		At: time.Now(), Op: packet.OpcodeStatUpdatePrivate, Id: id,
		Msg: append(msg, pairs...),
	}
}

// Only the 0x5209 snapshot carries the base stats, only the deltas that follow
// carry the current equipment — the panel needs both merged.
func TestPanelMergesSnapshotAndDeltas(t *testing.T) {
	p := &eventPublisher{entityCache: make(entityCache)}
	const id = uint64(4503599630022047)

	p.handleStatTable(statSnapshotPacket(id,
		packet.NewMessageElemInt(89557),     // 26 戰鬥力
		packet.NewMessageElemShort(11),      // 27
		packet.NewMessageElemFloat(8018.95), // 28 生命
		packet.NewMessageElemFloat(13361.9), // 29
		packet.NewMessageElemFloat(3611),    // 30 生命上限 base
		packet.NewMessageElemFloat(4407.95), // 31 生命上限 加成
	))
	// Equipment swap: only the mod is resent, the base never is.
	p.handleStatTable(statDeltaPacket(id,
		packet.NewMessageElemInt(31), packet.NewMessageElemFloat(4474.96),
	))

	panel, ok := p.panelOf(id)
	if !ok {
		t.Fatal("no panel for the entity")
	}
	if got := panel.LifeMax; got < 8085.9 || got > 8086.0 {
		t.Errorf("生命上限 = %v, want 8085.96 (3611 base + 4474.96 mod)", got)
	}
	if panel.CombatPower != 89557 {
		t.Errorf("戰鬥力 = %v, want 89557 (kept from the snapshot)", panel.CombatPower)
	}
}

func TestPanelOfUnknownEntity(t *testing.T) {
	p := &eventPublisher{entityCache: make(entityCache)}

	if _, ok := p.panelOf(123); ok {
		t.Error("panelOf reported a panel for an entity with no stats")
	}
}

// The raw account id must never reach the database.
func TestHandleBankListStoresHashedAccount(t *testing.T) {
	withTestItemDB(t)

	p := &eventPublisher{entityCache: make(entityCache)}
	msg, _ := packetFixtureMessage(t, "0x7212_page1.json")
	p.handleBankList(&packet.GamePacket{At: time.Now(), Op: packet.OpcodeBankList, Id: 7, Msg: msg})

	b, _ := packet.ParseBankListPacket(msg)
	acctId := bankEntityId(b.Account)

	var stored, name string
	if err := itemDB.db.QueryRow(`SELECT account, name FROM entities WHERE id=?`, acctId).
		Scan(&stored, &name); err != nil {
		t.Fatal(err)
	}
	if stored == b.Account {
		t.Fatal("raw account id was written to the database")
	}
	if stored != accountHash(b.Account) {
		t.Fatalf("stored account = %q, want %q", stored, accountHash(b.Account))
	}
	if !strings.HasPrefix(name, "bank_") {
		t.Fatalf("bank entity name = %q, want a bank_ prefix", name)
	}
}

// skillCastPacket builds a 0x9093 packet: (int kind, short skillId, short).
// kind 806 is the skill-cast variant; every other kind on this opcode has a
// different shape entirely (capture 1786105610).
func skillCastPacket(casterId uint64, kind uint32, skillId uint16) *packet.GamePacket {
	return &packet.GamePacket{
		At: time.Now(),
		Op: packet.OpcodeEffect2,
		Id: casterId,
		Msg: packet.Message{
			packet.NewMessageElemInt(kind),
			packet.NewMessageElemShort(skillId),
			packet.NewMessageElemShort(208),
		},
	}
}

func TestHandleSkillCast(t *testing.T) {
	p := &eventPublisher{entityCache: make(entityCache), lastSentAt: time.Now()}
	p.handleSkillCast(skillCastPacket(4503599629596015, skillCastKind, 20019))

	p.Lock()
	defer p.Unlock()
	if len(p.pendingEvents) != 1 {
		t.Fatalf("pendingEvents = %d, want 1", len(p.pendingEvents))
	}
	ev, ok := p.pendingEvents[0].(*event.EventSkillCast)
	if !ok {
		t.Fatalf("event type = %T, want *event.EventSkillCast", p.pendingEvents[0])
	}
	if ev.SkillId != 20019 {
		t.Errorf("SkillId = %d, want 20019", ev.SkillId)
	}
	if ev.Id != "4503599629596015" {
		t.Errorf("Id = %q, want the caster", ev.Id)
	}
}

// 0x9093 carries at least a dozen unrelated kinds, and their shapes differ so
// much that reading a skill id out of the wrong one yields garbage rather than
// an error. Only 806 may produce an event.
func TestHandleSkillCastIgnoresOtherKinds(t *testing.T) {
	for _, kind := range []uint32{765, 334, 695, 1, 2} {
		p := &eventPublisher{entityCache: make(entityCache), lastSentAt: time.Now()}
		p.handleSkillCast(skillCastPacket(1, kind, 20019))
		p.Lock()
		n := len(p.pendingEvents)
		p.Unlock()
		if n != 0 {
			t.Errorf("kind %d produced %d events, want 0", kind, n)
		}
	}
}

// conditionUpdatePacket builds a 0xA028 character-condition update:
// (byte enable, int ccId, long disableAt, string params, long attackerId).
func conditionUpdatePacket(id uint64, ccId uint32, params string) *packet.GamePacket {
	return &packet.GamePacket{
		At: time.Now(),
		Op: packet.OpcodeCharacterConditionUpdate,
		Id: id,
		Msg: packet.Message{
			packet.NewMessageElemByte(1),
			packet.NewMessageElemInt(ccId),
			packet.NewMessageElemLong(63922323583596),
			packet.NewMessageElemString(params),
			packet.NewMessageElemLong(4503599629596015),
		},
	}
}

// Params is the only path a condition's magnitudes take to the UI, and losing
// it renders as an empty indicator — indistinguishable from "no buff at all".
func TestHandleConditionUpdatePublishesParams(t *testing.T) {
	p := &eventPublisher{entityCache: make(entityCache), lastSentAt: time.Now()}
	p.handleConditionUpdate(conditionUpdatePacket(4503599630022047, 680,
		"MCMBAMIN:f:32.200001;MCMBAMAX:f:32.200001;MCMBAC:f:8.5;SBT:8:63922323583596;"))

	p.Lock()
	defer p.Unlock()
	if len(p.pendingEvents) != 1 {
		t.Fatalf("pendingEvents = %d, want 1", len(p.pendingEvents))
	}
	ev, ok := p.pendingEvents[0].(*event.EventCharacterConditionEnable)
	if !ok {
		t.Fatalf("event type = %T, want *event.EventCharacterConditionEnable", p.pendingEvents[0])
	}
	if len(ev.Params) == 0 {
		t.Fatal("Params is empty — the condition magnitudes never reach the UI")
	}
	if ev.Params["MCMBAMIN"] != "32.200001" {
		t.Errorf("Params[MCMBAMIN] = %q, want 32.200001", ev.Params["MCMBAMIN"])
	}
	if ev.Params["MCMBAC"] != "8.5" {
		t.Errorf("Params[MCMBAC] = %q, want 8.5", ev.Params["MCMBAC"])
	}
	if ev.CCId != 680 {
		t.Errorf("CCId = %d, want 680", ev.CCId)
	}
	if ev.Id != "4503599630022047" {
		t.Errorf("Id = %q, want the affected entity", ev.Id)
	}
}

// A client that connects mid-fight rebuilds its state from snapshotEvents, so
// the magnitudes have to survive that path too.
func TestSnapshotEventsCarryConditionParams(t *testing.T) {
	p := &eventPublisher{entityCache: make(entityCache), lastSentAt: time.Now()}
	p.entityCache[7] = &entityInfoExtend{
		EntityInfo: &packet.EntityInfo{Id: 7, Name: "測試角色", RaceId: 10002},
		characterConditionMap: map[uint32]*packet.EntityCharacterCondition{
			516: {CCId: 516, Params: map[string]string{"SOP_DMG_MINMAX": "15", "SOP_CRITICAL": "15"}},
		},
	}

	for _, ev := range p.snapshotEvents(false) {
		ce, ok := ev.(*event.EventCharacterConditionEnable)
		if !ok || ce.CCId != 516 {
			continue
		}
		if ce.Params["SOP_DMG_MINMAX"] != "15" || ce.Params["SOP_CRITICAL"] != "15" {
			t.Fatalf("Params = %v, want SOP_DMG_MINMAX and SOP_CRITICAL 15", ce.Params)
		}
		return
	}
	t.Fatal("snapshotEvents() produced no EventCharacterConditionEnable for CC 516")
}

// newEventPublisherForTest builds a publisher ready for handler tests, with
// a known ownerId so events attributed to the local player can be checked.
func newEventPublisherForTest(t *testing.T) *eventPublisher {
	t.Helper()
	return &eventPublisher{
		entityCache: make(entityCache),
		bossEntities: make(map[uint64]string),
		maxLifeSeen: make(map[uint64]float64),
		downedEntities: make(map[uint64]bool),
		lastSentAt:  time.Now(),
		ownerId:     999,
	}
}

// Captured 0x526D message bodies (uvarint elem length + elements), taken
// verbatim from research/data — a hand-built fixture that did not exist on
// the wire once hid a dead handler for three tasks' worth of work.
const (
	// 「地獄哞菇 向敵軍演奏非常響亮的戰場上的狂吼.」— a bard song starting.
	bodyBardsongStart = "83010200010406007EE59CB0E78D84E5939EE88F8720E59091E695B5E8BB8DE6BC94E5A58FE9" +
		"9D9EE5B8B8E99FBFE4BAAEE79A84E688B0E5A0B4E4B88AE79A84E78B82E590BC2E0AE69C80E5A4A7E694BB" +
		"E6938AE58A9BE5A29EE58AA0E4BA8620333525202E0AE69C80E5B08FE694BBE6938AE58A9BE5A29EE58AA0" +
		"E4BA8620333525202E0A00"
	// 「演奏的效果消失.」— the generic bard-song ending.
	bodyBardsongEnd = "1C02000104060017E6BC94E5A58FE79A84E69588E69E9CE6B688E5A4B12E00"
	// 「戰場的序曲 效果消失.」— the 序曲 music skill ending (category 4, not a song).
	bodyMusicSkillEnd = "230200010406001EE688B0E5A0B4E79A84E5BA8FE69BB220E69588E69E9CE6B688E5A4B12E00"
	// 「蘑菇嫩煎雞的戰場的序曲發出迴響.」— the 序曲 start; carries 增加 NN% lines.
	bodyMusicSkillStart = "870102000104060082E89891E88F87E5ABA9E7858EE99B9EE79A84E688B0E5A0B4E79A84E5BA" +
		"8FE69BB2E799BCE587BAE8BFB4E99FBF2E0AE69C80E5B08FE694BBE6938AE58A9BE5A29EE58AA033322E32" +
		"30252E0AE69C80E5A4A7E694BBE6938AE58A9BE5A29EE58AA02033322E3230252E0AE69AB4E6938AE78E87" +
		"E5A29EE58AA02031372E3731252E00"
	// 「Ja** 已成功製作 布里安安德斯輕靈手套 . (CHANNEL11)」— category 2, (Byte,String,Int).
	bodyCraftBroadcast = "4C030001020600424A612A2A20E5B7B2E68890E58A9FE8A3BDE4BD9C20E5B883E9878CE5AE89" +
		"E5AE89E5BEB7E696AFE8BC95E99D88E6898BE5A597202E20284348414E4E454C313129000300004E20"
)

// capturedNoticePacket decodes a captured 0x526D body through the same
// packet.NewMessage path production uses. Id is distinct from the test
// ownerId, so an event that wrongly keyed off the packet's Id would be caught.
func capturedNoticePacket(t *testing.T, bodyHex string) *packet.GamePacket {
	t.Helper()
	raw, err := hex.DecodeString(bodyHex)
	if err != nil {
		t.Fatalf("bad fixture hex: %v", err)
	}
	// The capture keeps the packet's message-length varint; the reader
	// consumes it before NewMessage, so skip exactly as many bytes.
	_, n := binary.Uvarint(raw)
	if n <= 0 {
		t.Fatalf("bad message length varint: %v", n)
	}
	msg, err := packet.NewMessage(bytes.NewReader(raw[n:]))
	if err != nil {
		t.Fatalf("NewMessage: %v", err)
	}
	return &packet.GamePacket{At: time.Now(), Op: packet.OpcodeNotice, Id: 12345, Msg: msg}
}

// noticePacket builds a 0x526D notice GamePacket carrying text in the wire
// shape (Byte category, String message). Prefer capturedNoticePacket when the
// shape itself matters; this is for exercising the text-matching branches.
func noticePacket(t *testing.T, text string) *packet.GamePacket {
	t.Helper()
	return noticePacketOfCategory(t, noticeCategoryBuff, text)
}

func noticePacketOfCategory(t *testing.T, category uint8, text string) *packet.GamePacket {
	t.Helper()
	return &packet.GamePacket{
		At: time.Now(),
		Op: packet.OpcodeNotice,
		Id: 12345,
		Msg: packet.Message{
			packet.NewMessageElemByte(category),
			packet.NewMessageElemString(text),
		},
	}
}

// lastEventOfType returns the most recently published event of type T,
// failing the test if none was published.
func lastEventOfType[T event.IEvent](t *testing.T, p *eventPublisher) T {
	t.Helper()
	p.Lock()
	defer p.Unlock()
	for i := len(p.pendingEvents) - 1; i >= 0; i-- {
		if ev, ok := p.pendingEvents[i].(T); ok {
			return ev
		}
	}
	var zero T
	t.Fatalf("no event of type %T published", zero)
	return zero
}

// hasEventOfType reports whether p has published an event of type T.
func hasEventOfType[T event.IEvent](p *eventPublisher) bool {
	p.Lock()
	defer p.Unlock()
	for _, ev := range p.pendingEvents {
		if _, ok := ev.(T); ok {
			return true
		}
	}
	return false
}

// The wire shape is (Byte category, String message) with an optional Int
// tail. Element 0 is never the text — reading it as such made the whole
// bard-song path unreachable on real traffic.
func TestCapturedNoticeShape(t *testing.T) {
	for name, bodyHex := range map[string]string{
		"bardsongStart":  bodyBardsongStart,
		"bardsongEnd":    bodyBardsongEnd,
		"musicSkillEnd":  bodyMusicSkillEnd,
		"craftBroadcast": bodyCraftBroadcast,
	} {
		msg := capturedNoticePacket(t, bodyHex).Msg
		if len(msg) < 2 {
			t.Errorf("%s: %d elems, want >= 2", name, len(msg))
			continue
		}
		if msg[0].Type() != packet.MessageElemTypeByte {
			t.Errorf("%s: elem 0 is %v, want Byte (category)", name, msg[0].Type())
		}
		if msg[1].Type() != packet.MessageElemTypeString {
			t.Errorf("%s: elem 1 is %v, want String (message)", name, msg[1].Type())
		}
	}
}

// Drives a real captured 戰吼 notice, bytes and all, through the handler. The
// announcement is private, so the event must be keyed by ownerId, not by the
// packet's Id.
func TestHandleNoticeEmitsBardsong(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.handleNotice(capturedNoticePacket(t, bodyBardsongStart))

	e := lastEventOfType[*event.EventBardsong](t, p)
	if e.Performer != "地獄哞菇" || e.Bonuses["最大攻擊力"] != 35 || e.IsEnd {
		t.Fatalf("got %+v", e)
	}
	if e.Song != "向敵軍演奏非常響亮的戰場上的狂吼" {
		t.Errorf("Song = %q", e.Song)
	}
	if e.Id != "999" {
		t.Errorf("Id = %q, want ownerId 999 (not the packet's Id)", e.Id)
	}
}

func TestHandleNoticeEmitsBardsongEnd(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.handleNotice(capturedNoticePacket(t, bodyBardsongEnd))

	if e := lastEventOfType[*event.EventBardsong](t, p); !e.IsEnd {
		t.Fatalf("got %+v, want IsEnd", e)
	}
}

// 序曲 has its own CC-680 lane. Accepting its start while rejecting its end
// would latch the bard-song lane on for the rest of the fight.
func TestHandleNoticeIgnoresMusicSkill(t *testing.T) {
	for name, bodyHex := range map[string]string{
		"start": bodyMusicSkillStart,
		"end":   bodyMusicSkillEnd,
	} {
		p := newEventPublisherForTest(t)
		p.handleNotice(capturedNoticePacket(t, bodyHex))
		if hasEventOfType[*event.EventBardsong](p) {
			t.Errorf("music-skill %s produced a bardsong event", name)
		}
		if !hasEventOfType[*event.EventNotice](p) {
			t.Errorf("music-skill %s produced no notice event", name)
		}
	}
}

// A server-wide broadcast (category 2) is still a notice, but must never
// reach the bard-song parser.
func TestHandleNoticeIgnoresOtherCategories(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.handleNotice(capturedNoticePacket(t, bodyCraftBroadcast))
	if !hasEventOfType[*event.EventNotice](p) {
		t.Fatal("a broadcast notice must still publish EventNotice")
	}
	if hasEventOfType[*event.EventBardsong](p) {
		t.Fatal("a broadcast notice produced a bardsong event")
	}
	if e := lastEventOfType[*event.EventNotice](t, p); e.Category == noticeCategoryBuff {
		t.Errorf("Category = %d, want the broadcast category", e.Category)
	}
}

func TestHandleNoticeIgnoresUnrelated(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.handleNotice(noticePacket(t, "某人 已成功製作 某物 ."))
	if hasEventOfType[*event.EventBardsong](p) {
		t.Fatal("unrelated notice produced a bardsong event")
	}
}

// handleNotice's existing EventNotice publish must survive: bardsong
// detection is additive, not a replacement.
func TestHandleNoticeStillEmitsNotice(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.handleNotice(capturedNoticePacket(t, bodyBardsongStart))

	if !hasEventOfType[*event.EventNotice](p) {
		t.Fatal("handleNotice no longer publishes EventNotice")
	}
}

func TestHandleNoticeRejectsWrongShape(t *testing.T) {
	for name, msg := range map[string]packet.Message{
		"empty": {},
		"stringOnly": {packet.NewMessageElemString(
			"地獄哞菇 向敵軍演奏非常響亮的戰場上的狂吼.\n最大攻擊力增加了 35% .\n")},
		"categoryOnly": {packet.NewMessageElemByte(noticeCategoryBuff)},
	} {
		p := newEventPublisherForTest(t)
		p.handleNotice(&packet.GamePacket{
			At: time.Now(), Op: packet.OpcodeNotice, Id: 12345, Msg: msg,
		})
		p.Lock()
		n := len(p.pendingEvents)
		p.Unlock()
		if n != 0 {
			t.Errorf("%s produced %d events, want 0", name, n)
		}
	}
}

func TestHandleSkillCastRejectsWrongShape(t *testing.T) {
	short := &packet.GamePacket{
		At: time.Now(), Op: packet.OpcodeEffect2, Id: 1,
		Msg: packet.Message{packet.NewMessageElemInt(skillCastKind)},
	}
	wrongTypes := &packet.GamePacket{
		At: time.Now(), Op: packet.OpcodeEffect2, Id: 1,
		Msg: packet.Message{
			packet.NewMessageElemInt(skillCastKind),
			packet.NewMessageElemString("not a skill id"),
			packet.NewMessageElemShort(0),
		},
	}
	for name, pk := range map[string]*packet.GamePacket{"short": short, "wrongTypes": wrongTypes} {
		p := &eventPublisher{entityCache: make(entityCache), lastSentAt: time.Now()}
		p.handleSkillCast(pk)
		p.Lock()
		n := len(p.pendingEvents)
		p.Unlock()
		if n != 0 {
			t.Errorf("%s produced %d events, want 0", name, n)
		}
	}
}

// combatSub describes one CombatActionPackPacket sub-packet for
// combatActionPacket. HasHit selects a struck-target sub-packet (Hit != nil)
// instead of the attacker's own action sub-packet (Hit == nil, the one
// carrying EntityId/SkillId that handleCombatAction reads).
type combatSub struct {
	EntityId uint64
	SkillId  uint16
	HasHit   bool
}

// combatSubPacketBytes encodes one sub-packet exactly as
// lib/packet/combatActionPacket.go decodes it: a raw embedded GamePacket
// (op uint32 BE, id uint64 BE, a length varint whose value
// GamePacketBodyReader reads but never uses, then a Message) holding
// (int combatActionId, long entityId, byte type, short stun, short skillId,
// short subSkillId, short unk1), plus a hit block (int options, float
// damage, float wound, int manaDamage) when HasHit is set.
func combatSubPacketBytes(s combatSub) []byte {
	// SkillActive|SkillSuccess with no TakeHit bit is the attacker's own
	// action; TakeHit alone is a struck target (Hit != nil, per parser).
	ttype := uint8(packet.CombatActionTypeSkillActive | packet.CombatActionTypeSkillSuccess)
	if s.HasHit {
		ttype = uint8(packet.CombatActionTypeTakeHit)
	}

	subMsg := packet.Message{
		packet.NewMessageElemInt(0), // combatActionId
		packet.NewMessageElemLong(s.EntityId),
		packet.NewMessageElemByte(ttype),
		packet.NewMessageElemShort(0), // stun
		packet.NewMessageElemShort(s.SkillId),
		packet.NewMessageElemShort(0), // subSkillId
		packet.NewMessageElemShort(0), // unk1
	}
	if s.HasHit {
		subMsg = append(subMsg,
			packet.NewMessageElemInt(0),   // hit options
			packet.NewMessageElemFloat(0), // damage
			packet.NewMessageElemFloat(0), // wound
			packet.NewMessageElemInt(0),   // manaDamage
		)
	}

	buf := make([]byte, 12)
	binary.BigEndian.PutUint32(buf[0:4], 0)           // op: unused by parseCombatActionPacket
	binary.BigEndian.PutUint64(buf[4:12], s.EntityId) // header id: unused by handleCombatAction
	buf = append(buf, 0x00)                           // length varint; value is discarded by GamePacketBodyReader
	buf = append(buf, subMsg.Bytes()...)
	return buf
}

// combatActionPacket builds a 0x7926 CombatActionPackPacket GamePacket
// containing subs as sub-packets, mirroring
// lib/packet/combatActionPacket.go's ParseCombatActionPackPacket: (int
// actionPackId, int prevId, byte hit, byte type, byte unk1, byte flag=0,
// int subPacketCount) followed by (int unused, bin subPacketBuf) per sub.
func combatActionPacket(t *testing.T, subs ...combatSub) *packet.GamePacket {
	t.Helper()

	msg := packet.Message{
		packet.NewMessageElemInt(1), // actionPackId
		packet.NewMessageElemInt(0), // prevCombatActionId
		packet.NewMessageElemByte(0),
		packet.NewMessageElemByte(0),
		packet.NewMessageElemByte(0),
		packet.NewMessageElemByte(0), // flag: no blocked-by-shield extension
		packet.NewMessageElemInt(uint32(len(subs))),
	}
	for _, s := range subs {
		msg = append(msg,
			packet.NewMessageElemInt(0), // element read but not validated by the parser
			packet.NewMessageElemBin(combatSubPacketBytes(s)),
		)
	}

	p := &packet.GamePacket{
		At:  time.Now(),
		Op:  packet.OpcodeCombatAction,
		Id:  1,
		Msg: msg,
	}

	// Fail loudly here rather than let a malformed fixture silently no-op
	// inside handleCombatAction.
	if _, err := packet.ParseCombatActionPackPacket(p); err != nil {
		t.Fatalf("combatActionPacket: fixture does not parse: %v", err)
	}

	return p
}

func TestHandleCombatActionEmitsSkillUseWithoutDamage(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.handleCombatAction(combatActionPacket(t, combatSub{
		EntityId: 7, SkillId: 30480, HasHit: false,
	}))

	e := lastEventOfType[*event.EventSkillUse](t, p)
	if e.SkillId != 30480 || e.Id != "7" {
		t.Fatalf("got %+v", e)
	}
	if hasEventOfType[*event.EventDamage](p) {
		t.Fatal("a no-damage sub-packet must not produce a damage event")
	}
}

func TestHandleCombatActionSkipsSkillIdZero(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.handleCombatAction(combatActionPacket(t, combatSub{EntityId: 7, SkillId: 0, HasHit: false}))
	if hasEventOfType[*event.EventSkillUse](p) {
		t.Fatal("skill id 0 must not be published")
	}
}

// A multi-target hit must not multiply the skill-use count by the number
// of struck targets: the publish lives outside the sub-packet loop, but
// nothing stops a future refactor from moving it back inside.
func TestHandleCombatActionMultiTargetPublishesSkillUseOnce(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.handleCombatAction(combatActionPacket(t,
		combatSub{EntityId: 7, SkillId: 30480, HasHit: false},
		combatSub{EntityId: 101, HasHit: true},
		combatSub{EntityId: 102, HasHit: true},
	))

	p.Lock()
	var skillUses []*event.EventSkillUse
	damages := 0
	for _, ev := range p.pendingEvents {
		switch e := ev.(type) {
		case *event.EventSkillUse:
			skillUses = append(skillUses, e)
		case *event.EventDamage:
			damages++
		}
	}
	p.Unlock()

	// Count asserted explicitly: lastEventOfType would pass even with
	// duplicates, which is exactly the bug this test guards against.
	if len(skillUses) != 1 {
		t.Fatalf("EventSkillUse count = %d, want 1 (once per pack, not per target)", len(skillUses))
	}
	if skillUses[0].SkillId != 30480 || skillUses[0].Id != "7" {
		t.Fatalf("got %+v", skillUses[0])
	}
	if damages != 2 {
		t.Fatalf("EventDamage count = %d, want 2 (one per struck target)", damages)
	}
}

// prepareStartPacket builds a 0x6984 skill-prepare-start GamePacket: a Short
// skillId then an arbitrary tail (three shapes exist; only the first element
// matters). Id differs from ownerId (999), so a wrong Id-vs-ownerId key would be caught.
func prepareStartPacket(t *testing.T, skillId uint16, tail packet.Message) *packet.GamePacket {
	t.Helper()
	msg := append(packet.Message{packet.NewMessageElemShort(skillId)}, tail...)
	return &packet.GamePacket{
		At:  time.Now(),
		Op:  packet.OpcodeSkillPrepareStart,
		Id:  12345,
		Msg: msg,
	}
}

// skillStopPacket builds a 0x698B skill-stop GamePacket: (Byte, Byte), with
// no skill id at all — the handler must recover it from remembered state.
func skillStopPacket(t *testing.T) *packet.GamePacket {
	t.Helper()
	return &packet.GamePacket{
		At: time.Now(),
		Op: packet.OpcodeSkillStop,
		Id: 12345,
		Msg: packet.Message{
			packet.NewMessageElemByte(0),
			packet.NewMessageElemByte(0),
		},
	}
}

func TestHandleSkillPrepareStartReadsOnlyTheFirstElement(t *testing.T) {
	for _, tail := range []packet.Message{
		{packet.NewMessageElemInt(2000)},
		{packet.NewMessageElemString("")},
		{packet.NewMessageElemString(""), packet.NewMessageElemLong(9)},
	} {
		p := newEventPublisherForTest(t)
		p.handleSkillPrepareStart(prepareStartPacket(t, 46004, tail))
		if e := lastEventOfType[*event.EventSkillPrepareStart](t, p); e.SkillId != 46004 {
			t.Fatalf("tail %v: SkillId = %d", tail, e.SkillId)
		}
	}
}

// 0x698B carries no skill id, so it has to reuse the one in flight.
func TestHandleSkillStopUsesTheRememberedSkill(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.handleSkillPrepareStart(prepareStartPacket(t, 46004, packet.Message{packet.NewMessageElemInt(0)}))
	p.handleSkillStop(skillStopPacket(t))

	if e := lastEventOfType[*event.EventSkillStop](t, p); e.SkillId != 46004 {
		t.Fatalf("SkillId = %d, want 46004", e.SkillId)
	}
}

func TestHandleSkillStopWithNothingInFlightIsSilent(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.handleSkillStop(skillStopPacket(t))
	if hasEventOfType[*event.EventSkillStop](p) {
		t.Fatal("stop with no prepared skill must not publish")
	}
}

// A repeated stop after the remembered skill was already consumed must not
// re-publish it — otherwise every later stop would replay the last cast.
func TestHandleSkillStopClearsAfterPublishing(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.handleSkillPrepareStart(prepareStartPacket(t, 46004, packet.Message{packet.NewMessageElemInt(0)}))
	p.handleSkillStop(skillStopPacket(t))
	p.handleSkillStop(skillStopPacket(t))

	p.Lock()
	n := 0
	for _, ev := range p.pendingEvents {
		if _, ok := ev.(*event.EventSkillStop); ok {
			n++
		}
	}
	p.Unlock()
	if n != 1 {
		t.Fatalf("EventSkillStop count = %d, want 1 (second stop must not re-publish)", n)
	}
}

// The category gate, pinned with text that WOULD parse as a bard song. The
// captured broadcast has no song marker, so it cannot catch the gate going
// missing — only a marker-bearing non-buff notice can.
func TestHandleNoticeGatesBardsongOnCategory(t *testing.T) {
	const broadcastCategory uint8 = 2
	p := newEventPublisherForTest(t)
	p.handleNotice(noticePacketOfCategory(t, broadcastCategory,
		"地獄哞菇 向敵軍演奏非常響亮的戰場上的狂吼.\n最大攻擊力增加了 35% .\n"))

	if hasEventOfType[*event.EventBardsong](p) {
		t.Error("a song announcement outside the buff category started a lane")
	}
	e := lastEventOfType[*event.EventNotice](t, p)
	if e.Category != broadcastCategory {
		t.Errorf("Category = %d, want %d", e.Category, broadcastCategory)
	}
}

// The dungeon file's seed carries player entities only: town NPCs seen since
// startup used to add 1,600+ appear events to every fight's log.
func TestSnapshotEventsPlayersOnly(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.entityCache[101] = &entityInfoExtend{EntityInfo: &packet.EntityInfo{Id: 101, Name: "玩家", RaceId: 10002}}
	p.entityCache[202] = &entityInfoExtend{EntityInfo: &packet.EntityInfo{Id: 202, Name: "路人怪", RaceId: 4856}}

	appears := func(playersOnly bool) []string {
		names := []string(nil)
		for _, ev := range p.snapshotEvents(playersOnly) {
			if a, ok := ev.(*event.EventEntityAppear); ok {
				names = append(names, a.Name)
			}
		}
		return names
	}

	if got := appears(true); len(got) != 1 || got[0] != "玩家" {
		t.Fatalf("playersOnly seed = %v, want only the player", got)
	}
	// The WS snapshot keeps everything — only the dungeon seed filters.
	if got := appears(false); len(got) != 2 {
		t.Fatalf("full snapshot = %v, want both entities", got)
	}
}

// One cast of 間奏展擊 (59165) arrives as two combat packs 0-3ms apart
// (capture 2026-08-19_13-42-20: packIds 3006547/3006548, flags differ so
// they are no dedup key). Same attacker + same skill within the window is
// one cast; the puppet's 54151 swings arrive 88-104ms apart and must stay
// distinct, as must a different attacker inside the window.
func TestHandleCombatActionMergesServerDoubleSend(t *testing.T) {
	p := newEventPublisherForTest(t)
	base := time.Now()

	at := func(ms int) time.Time { return base.Add(time.Duration(ms) * time.Millisecond) }
	cast := func(entity uint64, skill uint16, ms int) {
		pk := combatActionPacket(t, combatSub{EntityId: entity, SkillId: skill, HasHit: false})
		pk.At = at(ms)
		p.handleCombatAction(pk)
	}

	cast(7, 59165, 0)
	// The double-send's second pack carries real hits; merging the skill-use
	// event must not strip the skill id off its damage.
	dup := combatActionPacket(t,
		combatSub{EntityId: 7, SkillId: 59165, HasHit: false},
		combatSub{EntityId: 42, SkillId: 0, HasHit: true})
	dup.At = at(3)
	p.handleCombatAction(dup)
	cast(7, 59165, 200)  // past the window: a real re-cast
	cast(8, 59165, 201)  // different attacker inside the window: kept
	cast(9, 54151, 300)
	cast(9, 54151, 390)  // puppet swing spacing: kept

	n := 0
	p.Lock()
	for _, ev := range p.pendingEvents {
		if _, ok := ev.(*event.EventSkillUse); ok {
			n++
		}
	}
	p.Unlock()
	if n != 5 {
		t.Fatalf("EventSkillUse count = %d, want 5 (double-send merged, the rest kept)", n)
	}

	d := lastEventOfType[*event.EventDamage](t, p)
	if d.SkillId != 59165 {
		t.Fatalf("merged pack's damage SkillId = %d, want 59165", d.SkillId)
	}
}

// A public stat update (0x7532) carrying max life publishes EventMaxLife
// once, stays silent on repeats, and re-publishes on change (phase swap).
func statUpdatePublicPacket(id uint64, life, max float32) *packet.GamePacket {
	return &packet.GamePacket{
		Op: packet.OpcodeStatUpdatePublic, Id: id, At: time.Now(),
		Msg: packet.Message{
			packet.NewMessageElemByte(4),
			packet.NewMessageElemInt(11),
			packet.NewMessageElemInt(28), packet.NewMessageElemFloat(life),
			packet.NewMessageElemInt(30), packet.NewMessageElemFloat(max),
			packet.NewMessageElemInt(0),
		},
	}
}

func TestHandleStatUpdatePublishesMaxLifeOnChange(t *testing.T) {
	p := newEventPublisherForTest(t)

	p.handleStatUpdate(statUpdatePublicPacket(9, 698516160, 698517000))
	e := lastEventOfType[*event.EventMaxLife](t, p)
	if e.Id != "9" || e.MaxLife != float64(float32(698517000)) {
		t.Fatalf("got %+v", e)
	}

	p.handleStatUpdate(statUpdatePublicPacket(9, 600000000, 698517000))
	p.handleStatUpdate(statUpdatePublicPacket(9, 500000000, 850368576))

	p.Lock()
	var got []*event.EventMaxLife
	for _, ev := range p.pendingEvents {
		if e, ok := ev.(*event.EventMaxLife); ok {
			got = append(got, e)
		}
	}
	p.Unlock()
	if len(got) != 2 || got[1].MaxLife != float64(float32(850368576)) {
		t.Fatalf("want 2 events ending at new max, got %+v", got)
	}
}

func TestHandleStatUpdatePublicWithoutMaxIsSilent(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.handleStatUpdate(&packet.GamePacket{
		Op: packet.OpcodeStatUpdatePublic, Id: 9, At: time.Now(),
		Msg: packet.Message{
			packet.NewMessageElemByte(4),
			packet.NewMessageElemInt(11),
			packet.NewMessageElemInt(12), packet.NewMessageElemFloat(1),
		},
	})
	if hasEventOfType[*event.EventMaxLife](p) {
		t.Fatal("no max-life stat must not publish")
	}
}

// A tracked boss whose public life reaches zero publishes EventEntityDown
// exactly once; non-boss entities stay silent.
func TestHandleStatUpdatePublishesBossDownOnce(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.bossEntities[9] = "雷楠的米勒"

	p.handleStatUpdate(statUpdatePublicPacket(9, 5000, 1967880064))
	if hasEventOfType[*event.EventEntityDown](p) {
		t.Fatal("alive boss must not publish down")
	}
	p.handleStatUpdate(statUpdatePublicPacket(9, -100, 1967880064))
	e := lastEventOfType[*event.EventEntityDown](t, p)
	if e.Id != "9" {
		t.Fatalf("got %+v", e)
	}
	p.handleStatUpdate(statUpdatePublicPacket(9, -200, 1967880064))
	p.Lock()
	n := 0
	for _, ev := range p.pendingEvents {
		if _, ok := ev.(*event.EventEntityDown); ok {
			n++
		}
	}
	p.Unlock()
	if n != 1 {
		t.Fatalf("down published %d times, want 1", n)
	}

	// non-boss id
	p.handleStatUpdate(statUpdatePublicPacket(8, -1, 1000000))
	p.Lock()
	for _, ev := range p.pendingEvents {
		if d, ok := ev.(*event.EventEntityDown); ok && d.Id == "8" {
			t.Fatal("non-boss must not publish down")
		}
	}
	p.Unlock()
}

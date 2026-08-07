package main

import (
	"bytes"
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
	for _, ev := range p.snapshotEvents() {
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

package main

import (
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/packet"
)

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

package main

import (
	"os"
	"path/filepath"
	"strings"
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

func TestHandleBeautyRoomWritesCSV(t *testing.T) {
	orig := itemsLogDirPath
	itemsLogDirPath = t.TempDir()
	defer func() { itemsLogDirPath = orig }()

	p := &eventPublisher{entityCache: make(entityCache)}
	p.entityCache[7] = &entityInfoExtend{EntityInfo: &packet.EntityInfo{Id: 7, Name: "測試角色"}}

	p.handleBeautyRoom(beautyRoomPacket(7))

	path := filepath.Join(itemsLogDirPath, "美容室(測試角色).csv")
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("csv not written: %v", err)
	}
	s := string(b)
	if !strings.Contains(s, "12001") || !strings.Contains(s, "beauty") {
		t.Errorf("csv missing item row, got:\n%s", s)
	}
	if !strings.Contains(s, "# meta,美容室(測試角色),測試角色") {
		t.Errorf("csv missing meta row, got:\n%s", s)
	}
}

func TestHandleBeautyRoomSkipsUnknownOwner(t *testing.T) {
	orig := itemsLogDirPath
	itemsLogDirPath = t.TempDir()
	defer func() { itemsLogDirPath = orig }()

	p := &eventPublisher{entityCache: make(entityCache)}
	p.handleBeautyRoom(beautyRoomPacket(7)) // id 7 not in cache

	entries, _ := os.ReadDir(itemsLogDirPath)
	if len(entries) != 0 {
		t.Errorf("expected no files, got %d", len(entries))
	}
}

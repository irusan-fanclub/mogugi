package packet

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

// buildItemEntry 造一個 [Long][Byte 2][Bin 80] 序列當作一筆 item entry。
func buildItemEntry(itemID uint32, rec uint32) []IMessageElem {
	info := make([]byte, 80)
	le.PutUint32(info[0:], rec)
	le.PutUint32(info[4:], itemID)
	return []IMessageElem{
		NewMessageElemLong(0x1234),
		NewMessageElemByte(2),
		NewMessageElemBin(info),
	}
}

func TestParseEntitySnapshot_Synthetic(t *testing.T) {
	msg := Message{NewMessageElemString("小雞七號")} // 段 A 名稱
	msg = append(msg, NewMessageElemInt(10), NewMessageElemInt(10), NewMessageElemInt(2))
	msg = append(msg, buildItemEntry(40026, 2)...)
	msg = append(msg, buildItemEntry(12345, 86)...)

	snap, err := ParseEntitySnapshot(msg)
	if err != nil {
		t.Fatalf("ParseEntitySnapshot: %v", err)
	}
	if snap.Name != "小雞七號" {
		t.Fatalf("name=%q", snap.Name)
	}
	if len(snap.Items) != 2 || snap.Items[0].ItemID != 40026 || snap.Items[1].Container != "pet_bag" {
		t.Fatalf("items=%+v", snap.Items)
	}
}

func TestParseEntitySnapshot_Master(t *testing.T) {
	// Master.Name 是含 "PET_AI:" 的寵物屬性字串的前一個 String。
	msg := Message{
		NewMessageElemString("小雞七號"), // name
		NewMessageElemString(""),
		NewMessageElemString("嵐嵐小雞"),                       // master
		NewMessageElemString("PET_AI:s:OasisRuleSupport.xml;"), // pet props
	}
	snap, err := ParseEntitySnapshot(msg)
	if err != nil {
		t.Fatalf("ParseEntitySnapshot: %v", err)
	}
	if snap.Master != "嵐嵐小雞" {
		t.Fatalf("master=%q want 嵐嵐小雞", snap.Master)
	}
}

func TestParseEntitySnapshot_NoMaster(t *testing.T) {
	// 沒有寵物屬性字串（如自己角色）→ master 留空。
	msg := Message{NewMessageElemString("我的角色"), NewMessageElemString("foo")}
	snap, err := ParseEntitySnapshot(msg)
	if err != nil {
		t.Fatalf("ParseEntitySnapshot: %v", err)
	}
	if snap.Master != "" {
		t.Fatalf("master=%q want empty", snap.Master)
	}
}

type fixture struct {
	RawMessageHex string `json:"raw_message_hex"`
	Expected      struct {
		Name  string `json:"name"`
		Master string `json:"master"`
		Items []struct {
			ID        uint32 `json:"id"`
			Qty       uint32 `json:"qty"`
			Container string `json:"container"`
			X         uint32 `json:"x"`
			Y         uint32 `json:"y"`
		} `json:"items"`
	} `json:"expected"`
}

func loadFixture(t *testing.T, path string) (Message, fixture) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	var fx fixture
	if err := json.Unmarshal(b, &fx); err != nil {
		t.Fatalf("unmarshal fixture: %v", err)
	}
	raw, err := hex.DecodeString(fx.RawMessageHex)
	if err != nil {
		t.Fatalf("hex decode: %v", err)
	}
	msg, err := NewMessage(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("NewMessage: %v", err)
	}
	return msg, fx
}

func TestParseEntitySnapshot_RealFixture(t *testing.T) {
	msg, fx := loadFixture(t, "testdata/0x5209_sample.json")

	snap, err := ParseEntitySnapshot(msg)
	if err != nil {
		t.Fatalf("ParseEntitySnapshot: %v", err)
	}
	if snap.Name != fx.Expected.Name {
		t.Fatalf("name=%q want %q", snap.Name, fx.Expected.Name)
	}
	if snap.Master != fx.Expected.Master {
		t.Fatalf("master=%q want %q", snap.Master, fx.Expected.Master)
	}
	if len(snap.Items) != len(fx.Expected.Items) {
		t.Fatalf("got %d items, want %d: %+v", len(snap.Items), len(fx.Expected.Items), snap.Items)
	}
	for i, w := range fx.Expected.Items {
		g := snap.Items[i]
		if g.ItemID != w.ID || g.Qty != w.Qty || g.Container != w.Container || g.PosX != w.X || g.PosY != w.Y {
			t.Fatalf("item[%d]=%+v want id=%d qty=%d container=%s x=%d y=%d",
				i, g, w.ID, w.Qty, w.Container, w.X, w.Y)
		}
	}
}

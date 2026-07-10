package packet

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

// buildItemEntry builds a [Long][Byte 2][Bin 80] sequence as one item entry.
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

// buildItemEntryEnchant builds a full item entry:
// [Long][Byte 2][Bin 80][Bin 144][String opt][String], mirroring the real
// 0x5209 structure.
func buildItemEntryEnchant(itemID uint32, rec uint32, opt string) []IMessageElem {
	info := make([]byte, 80)
	le.PutUint32(info[0:], rec)
	le.PutUint32(info[4:], itemID)
	return []IMessageElem{
		NewMessageElemLong(0x1234),
		NewMessageElemByte(2),
		NewMessageElemBin(info),
		NewMessageElemBin(make([]byte, 144)),
		NewMessageElemString(opt),
		NewMessageElemString(""),
	}
}

func TestParseOptionInfo(t *testing.T) {
	cases := []struct {
		s              string
		prefix, suffix uint32
	}{
		{"", 0, 0},
		{"ENPFIX:4:21203;", 21203, 0},
		{"ENSFIX:4:11107;", 0, 11107},
		{"ENPFIX:4:21203;ENSFIX:4:11107;", 21203, 11107},
		{"PRP:4:10000;ENPFIX:4:21203;MCMA:b:false;", 21203, 0}, // mixed with other keys
		{"ENPFIX:4:notanumber;", 0, 0},
	}
	for _, c := range cases {
		p, s := parseOptionInfo(c.s)
		if p != c.prefix || s != c.suffix {
			t.Errorf("parseOptionInfo(%q)=(%d,%d) want (%d,%d)", c.s, p, s, c.prefix, c.suffix)
		}
	}
}

func TestParseExtEnchants_RealGlove(t *testing.T) {
	// Real Bin(144): Duke Hunter gloves (item 16009, capture 1783460656),
	// in-game "[prefix] empty, [suffix] Diligent" -> prefix 0 / suffix 30105.
	ext, err := hex.DecodeString(
		"012dd44168100000ac02000000000000401f0000401f0000401f0000000000000000000000000000" +
			"01000000000000000000000000000000000000000000997500002c4300000000ffffffff" +
			"000000000000000000000000000004000000000000000000174f0100000000000000000000000000" +
			"00000000000000000000000000000000000000000000000000000000")
	if err != nil {
		t.Fatal(err)
	}
	if len(ext) != 144 {
		t.Fatalf("fixture len=%d want 144", len(ext))
	}
	p, s := parseExtEnchants(ext)
	if p != 0 || s != 30105 {
		t.Fatalf("parseExtEnchants=(%d,%d) want (0,30105)", p, s)
	}
}

func TestParseExtEnchants_ShortOrEmpty(t *testing.T) {
	if p, s := parseExtEnchants(nil); p != 0 || s != 0 {
		t.Fatalf("nil: (%d,%d)", p, s)
	}
	if p, s := parseExtEnchants(make([]byte, 40)); p != 0 || s != 0 {
		t.Fatalf("short: (%d,%d)", p, s)
	}
	if p, s := parseExtEnchants(make([]byte, 144)); p != 0 || s != 0 {
		t.Fatalf("zero: (%d,%d)", p, s)
	}
}

func TestParseEntitySnapshot_EquipEnchantFromExtBin(t *testing.T) {
	// Equipment: option string empty, enchants in ext Bin @60(prefix)/@62(suffix).
	ext := make([]byte, 144)
	le.PutUint16(ext[60:], 20001) // prefix
	le.PutUint16(ext[62:], 30105) // suffix
	info := make([]byte, 80)
	le.PutUint32(info[0:], 2)
	le.PutUint32(info[4:], 16009)
	msg := Message{
		NewMessageElemString("嫩煎雞小羊01"),
		NewMessageElemLong(0x1234), NewMessageElemByte(2),
		NewMessageElemBin(info), NewMessageElemBin(ext),
		NewMessageElemString(""), NewMessageElemString(""),
	}
	snap, err := ParseEntitySnapshot(msg)
	if err != nil {
		t.Fatalf("ParseEntitySnapshot: %v", err)
	}
	if len(snap.Items) != 1 || snap.Items[0].EnchantPrefix != 20001 || snap.Items[0].EnchantSuffix != 30105 {
		t.Fatalf("items=%+v want prefix 20001 suffix 30105", snap.Items)
	}
}

func TestParseEntitySnapshot_MetalwareAndStats(t *testing.T) {
	// Mirrors the glove record from capture 1783467845: Bin80 -> Bin144 ->
	// 2xString -> Byte(4) -> 4xBin40 (1 kind=1 ignored + 3 kind=7 metalware).
	info := make([]byte, 80)
	le.PutUint32(info[0:], 2)
	le.PutUint32(info[4:], 16009)
	ext := make([]byte, 144)
	le.PutUint32(ext[16:], 8000) // durability
	le.PutUint32(ext[20:], 8000) // durability max
	le.PutUint16(ext[28:], 1)    // attack min
	le.PutUint16(ext[30:], 7)    // attack max
	le.PutUint32(ext[40:], 1)    // defense
	le.PutUint16(ext[62:], 30105)

	mw := func(kind, aid uint32, lv uint16) []byte {
		b := make([]byte, 40)
		le.PutUint32(b[0:], kind)
		le.PutUint16(b[14:], lv)
		le.PutUint32(b[36:], aid)
		return b
	}
	// Effect-line records: kind=1 suffix (real glove Crit +1, cond skill
	// Disassemble(10030) rank A), kind=0 prefix (negative, magic att -20),
	// kind=10 bless (max damage +29).
	eff := func(kind uint32, code uint16, value int16) []byte {
		b := make([]byte, 40)
		le.PutUint32(b[0:], kind)
		le.PutUint16(b[12:], code)
		le.PutUint16(b[14:], uint16(value))
		return b
	}
	roll := eff(1, 19, 1)
	le.PutUint16(roll[36:], 10030) // cond skill
	roll[39] = 6                   // cond rank A (u8 @39, mirrors real "2e 27 00 06")
	msg := Message{
		NewMessageElemString("嫩煎雞小羊01"),
		NewMessageElemLong(0x1234), NewMessageElemByte(2),
		NewMessageElemBin(info), NewMessageElemBin(ext),
		NewMessageElemString(""), NewMessageElemString(""),
		NewMessageElemByte(6),
		NewMessageElemBin(roll),
		NewMessageElemBin(eff(0, 53, -20)),
		NewMessageElemBin(eff(10, 16, 29)),
		NewMessageElemBin(mw(7, 4300106, 8)),
		NewMessageElemBin(mw(7, 3500403, 17)),
		NewMessageElemBin(mw(7, 3501002, 13)),
	}
	snap, err := ParseEntitySnapshot(msg)
	if err != nil {
		t.Fatalf("ParseEntitySnapshot: %v", err)
	}
	if len(snap.Items) != 1 {
		t.Fatalf("items=%+v", snap.Items)
	}
	it := snap.Items[0]
	if it.Durability != 8000 || it.DurabilityMax != 8000 || it.Defense != 1 || it.AttackMin != 1 || it.AttackMax != 7 {
		t.Fatalf("stats=%+v", it)
	}
	want := []MetalwareEntry{{4300106, 8}, {3500403, 17}, {3501002, 13}}
	if len(it.Metalware) != 3 {
		t.Fatalf("metalware=%+v", it.Metalware)
	}
	for i, w := range want {
		if it.Metalware[i] != w {
			t.Fatalf("metalware[%d]=%+v want %+v", i, it.Metalware[i], w)
		}
	}
	if it.EnchantSuffix != 30105 {
		t.Fatalf("suffix=%d", it.EnchantSuffix)
	}
	if len(it.SuffixEffects) != 1 || it.SuffixEffects[0] != (EnchantEffect{Code: 19, Value: 1, CondSkill: 10030, CondRank: 6}) {
		t.Fatalf("suffix effects=%+v", it.SuffixEffects)
	}
	if len(it.PrefixEffects) != 1 || it.PrefixEffects[0] != (EnchantEffect{Code: 53, Value: -20}) {
		t.Fatalf("prefix effects=%+v", it.PrefixEffects)
	}
	if len(it.BlessEffects) != 1 || it.BlessEffects[0] != (EnchantEffect{Code: 16, Value: 29}) {
		t.Fatalf("bless effects=%+v", it.BlessEffects)
	}
}

func TestParseEntitySnapshot_Enchant(t *testing.T) {
	// Real values from dilmeter_1783460656: prefix 21203 / suffix 11107.
	msg := Message{NewMessageElemString("嫩煎雞小羊01")}
	msg = append(msg, buildItemEntryEnchant(62005, 2, "ENPFIX:4:21203;")...)
	msg = append(msg, buildItemEntryEnchant(62005, 2, "ENSFIX:4:11107;")...)
	msg = append(msg, buildItemEntry(16009, 2)...) // legacy 3-element form, no enchant

	snap, err := ParseEntitySnapshot(msg)
	if err != nil {
		t.Fatalf("ParseEntitySnapshot: %v", err)
	}
	if len(snap.Items) != 3 {
		t.Fatalf("items=%d want 3: %+v", len(snap.Items), snap.Items)
	}
	if snap.Items[0].EnchantPrefix != 21203 || snap.Items[0].EnchantSuffix != 0 {
		t.Errorf("item0 enchant=%d/%d want 21203/0", snap.Items[0].EnchantPrefix, snap.Items[0].EnchantSuffix)
	}
	if snap.Items[1].EnchantPrefix != 0 || snap.Items[1].EnchantSuffix != 11107 {
		t.Errorf("item1 enchant=%d/%d want 0/11107", snap.Items[1].EnchantPrefix, snap.Items[1].EnchantSuffix)
	}
	if snap.Items[2].EnchantPrefix != 0 || snap.Items[2].EnchantSuffix != 0 {
		t.Errorf("item2 enchant=%d/%d want 0/0", snap.Items[2].EnchantPrefix, snap.Items[2].EnchantSuffix)
	}
}

func TestParseEntitySnapshot_Synthetic(t *testing.T) {
	msg := Message{NewMessageElemString("小雞七號")} // name
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
	// Master.Name is the String before the pet-props string ("PET_AI:").
	msg := Message{
		NewMessageElemString("小雞七號"), // name
		NewMessageElemString(""),
		NewMessageElemString("嵐嵐小雞"),                           // master
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
	// No pet-props string (e.g. own character) -> master stays empty.
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
		Name   string `json:"name"`
		Master string `json:"master"`
		Items  []struct {
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

func TestParseEntitySnapshot_BagMapping(t *testing.T) {
	// Bag (pocket 2, IBOR marker, Bin144@12=102) -> content pocket 102.
	bag := make([]byte, 80)
	le.PutUint32(bag[0:], 2)
	le.PutUint32(bag[4:], 5500008)
	bagExt := make([]byte, 144)
	le.PutUint32(bagExt[12:], 102) // Bin144 @12 = content pocket
	inBag := make([]byte, 80)
	le.PutUint32(inBag[0:], 102)
	le.PutUint32(inBag[4:], 1460011)
	msg := Message{
		NewMessageElemString("地域磨菇"),
		NewMessageElemLong(1), NewMessageElemByte(2),
		NewMessageElemBin(bag), NewMessageElemBin(bagExt),
		NewMessageElemString("IBOR:4:7;"), NewMessageElemString(""),
		NewMessageElemLong(2), NewMessageElemByte(2),
		NewMessageElemBin(inBag), NewMessageElemBin(make([]byte, 144)),
		NewMessageElemString(""), NewMessageElemString(""),
	}
	snap, err := ParseEntitySnapshot(msg)
	if err != nil {
		t.Fatalf("ParseEntitySnapshot: %v", err)
	}
	if len(snap.Items) != 2 {
		t.Fatalf("items=%+v", snap.Items)
	}
	if snap.Items[1].BagItemID != 5500008 {
		t.Fatalf("bagItemId=%d want 5500008", snap.Items[1].BagItemID)
	}
	if snap.Items[0].BagItemID != 0 {
		t.Fatalf("bag itself should not be in a bag: %d", snap.Items[0].BagItemID)
	}
}

package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/irusan-fanclub/mabidilmeter/lib/packet"
)

func TestSanitizeEntityName(t *testing.T) {
	cases := map[string]string{
		"小雞七號":      "小雞七號",
		"a/b\\c":    "a_b_c",
		"name:1*2?": "name_1_2_",
		"  trim  ":  "trim",
		"":          "_unnamed",
	}
	for in, want := range cases {
		if got := sanitizeEntityName(in); got != want {
			t.Fatalf("sanitizeEntityName(%q)=%q want %q", in, got, want)
		}
	}
}

func TestWriteAndReadItemIndex(t *testing.T) {
	dir := t.TempDir()
	snap := &packet.EntitySnapshot{
		Name:   "小雞七號",
		Master: "嵐嵐小雞",
		Items: []packet.InventoryItem{
			{ItemID: 40026, Qty: 1, Container: "main", PosX: 3, PosY: 0},
			{ItemID: 12345, Qty: 9, Container: "pet_bag", PosX: 0, PosY: 0},
		},
	}
	if err := writeEntityCSVTo(dir, snap); err != nil {
		t.Fatalf("write: %v", err)
	}
	// 覆寫語意：同實體再寫一次，內容應被取代而非追加。
	snap.Items = snap.Items[:1]
	if err := writeEntityCSVTo(dir, snap); err != nil {
		t.Fatalf("rewrite: %v", err)
	}

	idx, err := readItemIndexFrom(dir)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(idx) != 1 || idx[0].Entity != "小雞七號" || idx[0].Master != "嵐嵐小雞" {
		t.Fatalf("unexpected index: %+v", idx)
	}
	if len(idx[0].Items) != 1 || idx[0].Items[0].ID != 40026 {
		t.Fatalf("overwrite failed: %+v", idx[0].Items)
	}
}

func TestWriteAndReadItemIndex_Enchant(t *testing.T) {
	dir := t.TempDir()
	snap := &packet.EntitySnapshot{
		Name: "嫩煎雞小羊01",
		Items: []packet.InventoryItem{
			{ItemID: 62005, Qty: 1, Container: "main", EnchantPrefix: 21203, EnchantSuffix: 11107},
			{ItemID: 16009, Qty: 1, Container: "main"}, // 無賦予
		},
	}
	if err := writeEntityCSVTo(dir, snap); err != nil {
		t.Fatalf("write: %v", err)
	}
	idx, err := readItemIndexFrom(dir)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(idx) != 1 || len(idx[0].Items) != 2 {
		t.Fatalf("unexpected index: %+v", idx)
	}
	if idx[0].Items[0].EnchantPrefix != 21203 || idx[0].Items[0].EnchantSuffix != 11107 {
		t.Errorf("item0 enchant=%d/%d want 21203/11107", idx[0].Items[0].EnchantPrefix, idx[0].Items[0].EnchantSuffix)
	}
	if idx[0].Items[1].EnchantPrefix != 0 || idx[0].Items[1].EnchantSuffix != 0 {
		t.Errorf("item1 enchant=%d/%d want 0/0", idx[0].Items[1].EnchantPrefix, idx[0].Items[1].EnchantSuffix)
	}
}

func TestWriteAndReadItemIndex_MetalwareAndStats(t *testing.T) {
	dir := t.TempDir()
	snap := &packet.EntitySnapshot{
		Name: "嫩煎雞小羊01",
		Items: []packet.InventoryItem{
			{ItemID: 16009, Container: "main", EnchantSuffix: 30105,
				Durability: 8000, DurabilityMax: 8000, Defense: 1, AttackMin: 1, AttackMax: 7,
				Metalware: []packet.MetalwareEntry{{AbilityID: 4300106, Level: 8}, {AbilityID: 3501002, Level: 13}}},
		},
	}
	if err := writeEntityCSVTo(dir, snap); err != nil {
		t.Fatalf("write: %v", err)
	}
	idx, err := readItemIndexFrom(dir)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	it := idx[0].Items[0]
	if it.Durability != 8000 || it.DurabilityMax != 8000 || it.Defense != 1 || it.AttackMin != 1 || it.AttackMax != 7 {
		t.Fatalf("stats=%+v", it)
	}
	if len(it.Metalware) != 2 || it.Metalware[0] != (IndexMetalware{4300106, 8}) || it.Metalware[1] != (IndexMetalware{3501002, 13}) {
		t.Fatalf("metalware=%+v", it.Metalware)
	}
}

func TestWriteAndReadItemIndex_AllColumns(t *testing.T) {
	dir := t.TempDir()
	snap := &packet.EntitySnapshot{
		Name: "全欄位測試",
		Items: []packet.InventoryItem{{
			ItemID: 40026, Qty: 1, Container: "bag", PosX: 2, PosY: 5,
			Protection: 3, InjuryMin: 10, InjuryMax: 20, Balance: 55, Critical: 12,
			BagItemID: 999, Pocket: 34,
			PrefixEffects: []packet.EnchantEffect{{Code: 16, Value: 5}},
			SuffixEffects: []packet.EnchantEffect{{Code: 1, Value: -3, CondSkill: 20001, CondRank: 6}},
			BlessEffects:  []packet.EnchantEffect{{Code: 20, Value: 2}},
			RelicEffects:  []packet.EnchantEffect{{Code: 2558, Value: 400}},
			Colors:        [6]uint32{0xffffff, 0x112233, 0, 0, 0, 0xaabbcc},
			Metadata:      "IMROM:4:73003;OWNER:s:地域磨菇;",
		}},
	}
	if err := writeEntityCSVTo(dir, snap); err != nil {
		t.Fatalf("write: %v", err)
	}
	idx, err := readItemIndexFrom(dir)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	it := idx[0].Items[0]
	if it.Protection != 3 || it.InjuryMin != 10 || it.InjuryMax != 20 || it.Balance != 55 || it.Critical != 12 {
		t.Errorf("stats round-trip=%+v", it)
	}
	if it.BagItemID != 999 || it.Pocket != 34 {
		t.Errorf("bag/pocket=%d/%d want 999/34", it.BagItemID, it.Pocket)
	}
	if len(it.PrefixEffects) != 1 || it.PrefixEffects[0] != (IndexEnchantEffect{Code: 16, Value: 5}) {
		t.Errorf("prefix=%+v", it.PrefixEffects)
	}
	if len(it.SuffixEffects) != 1 || it.SuffixEffects[0] != (IndexEnchantEffect{Code: 1, Value: -3, CondSkill: 20001, CondRank: 6}) {
		t.Errorf("suffix (negative value + cond)=%+v", it.SuffixEffects)
	}
	if len(it.BlessEffects) != 1 || it.BlessEffects[0].Code != 20 {
		t.Errorf("bless=%+v", it.BlessEffects)
	}
	if len(it.RelicEffects) != 1 || it.RelicEffects[0] != (IndexEnchantEffect{Code: 2558, Value: 400}) {
		t.Errorf("relic=%+v", it.RelicEffects)
	}
	if len(it.Colors) != 6 || it.Colors[0] != "ffffff" || it.Colors[1] != "112233" || it.Colors[5] != "aabbcc" {
		t.Errorf("colors=%+v", it.Colors)
	}
	if it.Metadata != "IMROM:4:73003;OWNER:s:地域磨菇;" {
		t.Errorf("metadata=%q", it.Metadata)
	}
}

func TestReadItemIndex_TrueNameFromMeta(t *testing.T) {
	// 名字含非法字元時：檔名被消毒，但 # meta 列保留真實名字。
	dir := t.TempDir()
	snap := &packet.EntitySnapshot{Name: "a/b:c", Master: "主人", Items: []packet.InventoryItem{{ItemID: 1}}}
	if err := writeEntityCSVTo(dir, snap); err != nil {
		t.Fatal(err)
	}
	idx, err := readItemIndexFrom(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(idx) != 1 || idx[0].Entity != "a/b:c" || idx[0].Master != "主人" {
		t.Fatalf("want true name a/b:c from # meta, got %+v", idx)
	}
}

func TestReadItemIndex_LegacyCSV(t *testing.T) {
	// 舊版 5 欄 CSV（無賦予欄）要能讀，賦予預設 0。
	dir := t.TempDir()
	legacy := "# master,someone\nitem_id,qty,container,pos_x,pos_y\n40026,1,main,3,0\n"
	if err := os.WriteFile(filepath.Join(dir, "old.csv"), []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}
	idx, err := readItemIndexFrom(dir)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if len(idx) != 1 || len(idx[0].Items) != 1 {
		t.Fatalf("unexpected: %+v", idx)
	}
	it := idx[0].Items[0]
	if it.ID != 40026 || it.EnchantPrefix != 0 || it.EnchantSuffix != 0 {
		t.Errorf("legacy row=%+v want id 40026 enchant 0/0", it)
	}
}

func TestReadItemIndex_MissingDir(t *testing.T) {
	idx, err := readItemIndexFrom(filepath.Join(t.TempDir(), "nope"))
	if err != nil {
		t.Fatalf("missing dir should not error: %v", err)
	}
	if len(idx) != 0 {
		t.Fatalf("want empty, got %+v", idx)
	}
}

func TestWriteEntitySnapshot_UsesItemsLogDir(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "items_log")
	old := itemsLogDirPath
	itemsLogDirPath = dir
	defer func() { itemsLogDirPath = old }()

	snap := &packet.EntitySnapshot{Name: "汪汪", Items: []packet.InventoryItem{{ItemID: 7}}}
	if err := writeEntitySnapshot(snap); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "汪汪.csv")); err != nil {
		t.Fatalf("csv not written: %v", err)
	}
}

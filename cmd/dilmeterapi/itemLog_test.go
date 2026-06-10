package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/irusan-fanclub/mabidilmeter/lib/packet"
)

func TestSanitizeEntityName(t *testing.T) {
	cases := map[string]string{
		"小雞七號":    "小雞七號",
		"a/b\\c":   "a_b_c",
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
	dir := t.TempDir()
	old := osExecutable
	osExecutable = func() (string, error) { return filepath.Join(dir, "app.exe"), nil }
	defer func() { osExecutable = old }()

	snap := &packet.EntitySnapshot{Name: "汪汪", Items: []packet.InventoryItem{{ItemID: 7}}}
	if err := writeEntitySnapshot(snap); err != nil {
		t.Fatalf("write: %v", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "items_log", "汪汪.csv")); err != nil {
		t.Fatalf("csv not written: %v", err)
	}
}

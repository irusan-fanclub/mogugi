package main

import (
	"path/filepath"
	"testing"

	"github.com/irusan-fanclub/mogugi/lib/packet"
)

func testStore(t *testing.T) *itemStore {
	t.Helper()
	s, err := openItemStore(filepath.Join(t.TempDir(), "items.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s.Close)
	return s
}

// Regression: on a fresh install items_log/ doesn't exist yet (the CSV
// writers used to MkdirAll it; that path no longer runs). openItemStore
// must create missing parent directories itself.
func TestOpenItemStoreCreatesMissingDirs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "dir", "items.db")
	s, err := openItemStore(path)
	if err != nil {
		t.Fatalf("openItemStore with missing parents: %v", err)
	}
	t.Cleanup(s.Close)
}

func storeItems(ids ...uint32) []packet.InventoryItem {
	out := make([]packet.InventoryItem, 0, len(ids))
	for _, id := range ids {
		out = append(out, packet.InventoryItem{ItemID: id, Qty: 1, Container: "main"})
	}
	return out
}

func TestReplaceStorageOverwritesOnlyOwnPartition(t *testing.T) {
	s := testStore(t)
	me := entityMeta{Id: 100, Name: "角色A", RaceId: 10002}

	if err := s.ReplaceStorage(me, "inventory", storeItems(1, 2)); err != nil {
		t.Fatal(err)
	}
	if err := s.ReplaceStorage(me, "beauty", storeItems(3)); err != nil {
		t.Fatal(err)
	}
	// Overwrite inventory; beauty must survive.
	if err := s.ReplaceStorage(me, "inventory", storeItems(9)); err != nil {
		t.Fatal(err)
	}

	inv, _ := s.CountItems(100, "inventory")
	bty, _ := s.CountItems(100, "beauty")
	if inv != 1 || bty != 1 {
		t.Fatalf("inv=%d bty=%d, want 1/1", inv, bty)
	}

	idx, err := s.ReadIndex()
	if err != nil || len(idx) != 1 {
		t.Fatalf("ReadIndex: %v, %d entities", err, len(idx))
	}
	if idx[0].Entity != "角色A" || len(idx[0].Items) != 2 {
		t.Fatalf("got %+v", idx[0])
	}
}

func TestReplaceBankTabScope(t *testing.T) {
	s := testStore(t)
	acct := entityMeta{Id: bankEntityId("a2ff"), Name: bankEntityName("a2ffdeadbeef00112233")}

	itemsA := storeItems(10)
	itemsA[0].Container = "DunbartonBank"
	if err := s.ReplaceBankTab(acct, "分頁A", itemsA); err != nil {
		t.Fatal(err)
	}
	itemsB := storeItems(11, 12)
	if err := s.ReplaceBankTab(acct, "分頁B", itemsB); err != nil {
		t.Fatal(err)
	}
	// Refresh tab A only; tab B untouched. Then empty tab A (authoritative clear).
	if err := s.ReplaceBankTab(acct, "分頁A", storeItems(13)); err != nil {
		t.Fatal(err)
	}
	if err := s.ReplaceBankTab(acct, "分頁A", nil); err != nil {
		t.Fatal(err)
	}

	n, _ := s.CountItems(acct.Id, "bank")
	if n != 2 {
		t.Fatalf("bank items = %d, want 2 (tab B only)", n)
	}
	idx, _ := s.ReadIndex()
	if len(idx) != 1 || idx[0].Items[0].BagName != "分頁B" {
		t.Fatalf("got %+v", idx)
	}
}

func TestSetAccount(t *testing.T) {
	s := testStore(t)
	_ = s.ReplaceStorage(entityMeta{Id: 1, Name: "角色A"}, "inventory", storeItems(1))
	_ = s.ReplaceStorage(entityMeta{Id: 2, Name: "角色B"}, "inventory", storeItems(2))

	if err := s.SetAccountById(1, "acct-x"); err != nil {
		t.Fatal(err)
	}
	if err := s.SetAccountByNames("acct-x", []string{"角色B", "不存在"}); err != nil {
		t.Fatal(err)
	}
	// Account survives a later ReplaceStorage upsert.
	_ = s.ReplaceStorage(entityMeta{Id: 1, Name: "角色A"}, "inventory", storeItems(1))

	idx, _ := s.ReadIndex()
	for _, e := range idx {
		if e.Account != "acct-x" {
			t.Fatalf("entity %s account=%q, want acct-x", e.Entity, e.Account)
		}
	}
}

func TestBankEntityId(t *testing.T) {
	if bankEntityId("abc") >= 0 {
		t.Error("bank entity id must be negative")
	}
	if bankEntityId("abc") != bankEntityId("abc") {
		t.Error("must be stable")
	}
	if got := bankEntityName("a2311532c29823386166"); got != "銀行(386166)" {
		t.Errorf("bankEntityName = %q", got)
	}
}

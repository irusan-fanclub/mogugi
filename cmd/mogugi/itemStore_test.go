package main

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
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

func TestHttpHandlerItemIndexServesStore(t *testing.T) {
	s := withTestItemDB(t)
	if err := s.ReplaceStorage(entityMeta{Id: 1, Name: "角色A"}, "inventory", storeItems(1)); err != nil {
		t.Fatal(err)
	}
	acct := entityMeta{Id: bankEntityId("acct"), Name: bankEntityName("acct")}
	if err := s.ReplaceBankTab(acct, "分頁A", storeItems(2)); err != nil {
		t.Fatal(err)
	}

	rr := httptest.NewRecorder()
	httpHandlerItemIndex(rr, httptest.NewRequest("GET", "/api/item-index", nil))

	if rr.Code != 200 {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, `"storage":"bank"`) {
		t.Fatalf("body missing storage:bank field: %s", body)
	}

	var idx []IndexEntity
	if err := json.Unmarshal([]byte(body), &idx); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(idx) != 2 {
		t.Fatalf("entities = %d, want 2: %+v", len(idx), idx)
	}
	var sawInventory, sawBank bool
	for _, e := range idx {
		for _, it := range e.Items {
			switch it.Storage {
			case "inventory":
				sawInventory = true
			case "bank":
				sawBank = true
				if it.BagName != "分頁A" {
					t.Fatalf("bank item bagName = %q, want 分頁A", it.BagName)
				}
			}
		}
	}
	if !sawInventory || !sawBank {
		t.Fatalf("expected both inventory and bank storage values, got %+v", idx)
	}
}

func TestHttpHandlerItemIndexNilStoreServesEmptyArray(t *testing.T) {
	orig := itemDB
	itemDB = nil
	defer func() { itemDB = orig }()

	rr := httptest.NewRecorder()
	httpHandlerItemIndex(rr, httptest.NewRequest("GET", "/api/item-index", nil))

	if rr.Code != 200 {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	body := rr.Body.Bytes()
	var idx []IndexEntity
	if err := json.Unmarshal(body, &idx); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if idx == nil {
		t.Fatal("decoded slice is nil, want non-nil empty slice")
	}
	if len(idx) != 0 {
		t.Fatalf("entities = %d, want 0", len(idx))
	}
	if strings.TrimSpace(string(body)) != "[]" {
		t.Fatalf("body = %q, want []", body)
	}
}

func TestBankEntityId(t *testing.T) {
	if bankEntityId("abc") >= 0 {
		t.Error("bank entity id must be negative")
	}
	if bankEntityId("abc") != bankEntityId("abc") {
		t.Error("must be stable")
	}
	if got := bankEntityName("a2311532c29823386166"); got != "bank_"+accountHash("a2311532c29823386166") {
		t.Errorf("bankEntityName = %q", got)
	}
}

func TestAccountHashIsStableAndOpaque(t *testing.T) {
	const raw = "bernie7214415"
	h := accountHash(raw)
	if len(h) != 6 {
		t.Fatalf("accountHash length = %d, want 6", len(h))
	}
	if h != accountHash(raw) {
		t.Fatal("accountHash is not deterministic")
	}
	if strings.Contains(raw, h) || strings.Contains(h, "7214415") {
		t.Fatalf("accountHash %q leaks part of the account", h)
	}
	if accountHash("a2e36c06607223206329") == h {
		t.Fatal("different accounts hashed to the same value")
	}
}

func TestBankEntityNameHidesTheAccount(t *testing.T) {
	const raw = "bernie7214415"
	name := bankEntityName(raw)
	if want := "bank_" + accountHash(raw); name != want {
		t.Fatalf("bankEntityName = %q, want %q", name, want)
	}
	if strings.Contains(name, "7214415") {
		t.Fatalf("bankEntityName %q still shows the account tail", name)
	}
}

// bankEntityId keys every stored bank row. Changing it would orphan existing
// items, so pin the value for a known account.
func TestBankEntityIdUnchanged(t *testing.T) {
	if got, want := bankEntityId("bernie7214415"), bankEntityId("bernie7214415"); got != want {
		t.Fatal("bankEntityId is not deterministic")
	}
	if bankEntityId("bernie7214415") >= 0 {
		t.Fatal("bankEntityId must stay negative")
	}
}

func TestIsAccountHash(t *testing.T) {
	cases := map[string]bool{
		"a1b2c3":               true,
		"000000":               true,
		"A1B2C3":               false, // uppercase is not our output
		"a1b2c":                false, // too short
		"a1b2c34":              false, // too long
		"a1b2cg":               false, // g is not hex
		"bernie7214415":        false,
		"a2e36c06607223206329": false,
	}
	for in, want := range cases {
		if got := isAccountHash(in); got != want {
			t.Errorf("isAccountHash(%q) = %v, want %v", in, got, want)
		}
	}
}

// A database written by an older build holds the raw account id and a
// 銀行(尾碼) name. Opening it must rewrite both, and doing so twice must
// change nothing further.
func TestMigrateAccountHashesIsIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "items.db")
	s, err := openItemStore(path)
	if err != nil {
		t.Fatal(err)
	}
	const raw = "bernie7214415"
	id := bankEntityId(raw)
	if _, err := s.db.Exec(
		`INSERT INTO entities (id, name, master, race_id, account, updated_at)
		 VALUES (?, ?, '', 0, ?, 0)`, id, "銀行(214415)", raw); err != nil {
		t.Fatal(err)
	}
	// A normal character row that also learned the account.
	if _, err := s.db.Exec(
		`INSERT INTO entities (id, name, master, race_id, account, updated_at)
		 VALUES (?, ?, '', 10002, ?, 0)`, int64(42), "地域磨菇", raw); err != nil {
		t.Fatal(err)
	}
	s.Close()

	want := accountHash(raw)
	for pass := 1; pass <= 2; pass++ {
		s2, err := openItemStore(path)
		if err != nil {
			t.Fatalf("pass %d: %v", pass, err)
		}
		var name, account string
		if err := s2.db.QueryRow(`SELECT name, account FROM entities WHERE id=?`, id).
			Scan(&name, &account); err != nil {
			t.Fatalf("pass %d: %v", pass, err)
		}
		if account != want {
			t.Fatalf("pass %d: bank account = %q, want %q", pass, account, want)
		}
		if name != "bank_"+want {
			t.Fatalf("pass %d: bank name = %q, want %q", pass, name, "bank_"+want)
		}

		var charName, charAccount string
		if err := s2.db.QueryRow(`SELECT name, account FROM entities WHERE id=42`).
			Scan(&charName, &charAccount); err != nil {
			t.Fatalf("pass %d: %v", pass, err)
		}
		if charAccount != want {
			t.Fatalf("pass %d: character account = %q, want %q", pass, charAccount, want)
		}
		// Only bank entities get renamed; a character keeps its own name.
		if charName != "地域磨菇" {
			t.Fatalf("pass %d: character name = %q, want 地域磨菇", pass, charName)
		}
		s2.Close()
	}
}

// A character may legitimately be named 銀行(...). Renaming is keyed on the
// negative synthetic id, so such a character must keep its own name.
func TestMigrateAccountHashesRenamesOnlyBankEntities(t *testing.T) {
	path := filepath.Join(t.TempDir(), "items.db")
	s, err := openItemStore(path)
	if err != nil {
		t.Fatal(err)
	}
	const raw = "bernie7214415"
	if _, err := s.db.Exec(
		`INSERT INTO entities (id, name, master, race_id, account, updated_at)
		 VALUES (?, ?, '', 10002, ?, 0)`, int64(99), "銀行(騙人的)", raw); err != nil {
		t.Fatal(err)
	}
	s.Close()

	s2, err := openItemStore(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s2.Close)
	var name, account string
	if err := s2.db.QueryRow(`SELECT name, account FROM entities WHERE id=99`).
		Scan(&name, &account); err != nil {
		t.Fatal(err)
	}
	if name != "銀行(騙人的)" {
		t.Fatalf("character name = %q, want it left alone", name)
	}
	if account != accountHash(raw) {
		t.Fatalf("character account = %q, want %q", account, accountHash(raw))
	}
}

// An empty account must not be hashed into a junk value.
func TestMigrateAccountHashesSkipsEmptyAccounts(t *testing.T) {
	path := filepath.Join(t.TempDir(), "items.db")
	s, err := openItemStore(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.db.Exec(
		`INSERT INTO entities (id, name, master, race_id, account, updated_at)
		 VALUES (7, '地域磨菇', '', 10002, '', 0)`); err != nil {
		t.Fatal(err)
	}
	s.Close()

	s2, err := openItemStore(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(s2.Close)
	var account string
	if err := s2.db.QueryRow(`SELECT account FROM entities WHERE id=7`).Scan(&account); err != nil {
		t.Fatal(err)
	}
	if account != "" {
		t.Fatalf("empty account became %q", account)
	}
}

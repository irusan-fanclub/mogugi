package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// writeFile creates name under dir with content, failing the test on error.
func writeFile(t *testing.T, dir, name, content string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(content), 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

func TestScanBattleRecordsReadsOnlyTheFirstLine(t *testing.T) {
	dir := t.TempDir()
	const name = "dungeon_brileith_NRD_1S_a_2026-08-17_09-00-00.ndjson"
	writeFile(t, dir, name,
		`{"Kind":"meta","Code":"brileith","Tier":"NRD_1S","Player":"a","StartedAtLocal":"2026-08-17T09:00:00+08:00"}`+"\n"+
			`{"EventId":1}`+"\n")

	got, err := scanBattleRecords(dir)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(got) != 1 || got[0].Tier != "NRD_1S" || got[0].StartedAtLocal != "2026-08-17T09:00:00+08:00" {
		t.Fatalf("got %+v", got)
	}
	// File is the v-for key and Code/Player/SizeBytes feed the visible
	// columns; a silent regression to zero values must fail this test.
	if got[0].Code != "brileith" || got[0].Player != "a" || got[0].File != name || got[0].SizeBytes <= 0 {
		t.Fatalf("got %+v", got)
	}
}

// Files written before the metadata header exists must not break the list.
func TestScanBattleRecordsSkipsHeaderlessFiles(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "dungeon_old_a_1786800000.ndjson", `{"EventId":1}`+"\n")
	got, err := scanBattleRecords(dir)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("got %+v, want none", got)
	}
}

func TestScanBattleRecordsSortsNewestFirst(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, dir, "a.ndjson", `{"Kind":"meta","StartedAtLocal":"2026-08-17T09:00:00+08:00"}`+"\n")
	writeFile(t, dir, "b.ndjson", `{"Kind":"meta","StartedAtLocal":"2026-08-17T10:00:00+08:00"}`+"\n")
	got, _ := scanBattleRecords(dir)
	if got[0].StartedAtLocal != "2026-08-17T10:00:00+08:00" {
		t.Fatalf("got %+v, want newest first", got)
	}
}

func TestScanBattleRecordsMissingDirIsEmptyNotError(t *testing.T) {
	got, err := scanBattleRecords(filepath.Join(t.TempDir(), "nope"))
	if err != nil || len(got) != 0 {
		t.Fatalf("got %v / %v, want empty and no error", got, err)
	}
}

func TestHttpHandlerBattleIndexServesShape(t *testing.T) {
	dir := t.TempDir()
	orig := dungeonLogDirPath
	dungeonLogDirPath = dir
	defer func() { dungeonLogDirPath = orig }()

	writeFile(t, dir, "dungeon_brileith_NRD_1S_a_2026-08-17_09-00-00.ndjson",
		`{"Kind":"meta","Code":"brileith","Tier":"NRD_1S","Player":"a","StartedAtLocal":"2026-08-17T09:00:00+08:00"}`+"\n")

	rr := httptest.NewRecorder()
	httpHandlerBattleIndex(rr, httptest.NewRequest("GET", "/api/battles", nil))

	if rr.Code != 200 {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	var body struct {
		Battles []BattleRecord `json:"battles"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(body.Battles) != 1 || body.Battles[0].Code != "brileith" {
		t.Fatalf("got %+v", body.Battles)
	}
}

func TestHttpHandlerBattleIndexEmptyIsArrayNotNull(t *testing.T) {
	orig := dungeonLogDirPath
	dungeonLogDirPath = filepath.Join(t.TempDir(), "nope")
	defer func() { dungeonLogDirPath = orig }()

	rr := httptest.NewRecorder()
	httpHandlerBattleIndex(rr, httptest.NewRequest("GET", "/api/battles", nil))

	if rr.Code != 200 {
		t.Fatalf("status = %d, want 200", rr.Code)
	}
	body := rr.Body.String()
	if body != `{"battles":[]}`+"\n" {
		t.Fatalf("body = %q, want {\"battles\":[]}", body)
	}
}

// A file whose last line is a summary yields one fight row per stage;
// files without one (still-recording) have no fights.
func TestScanBattleRecordsReadsSummaryTail(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir
	writeFile(t, dir, "dungeon_brileith_MRD_1S_a_20260819_090000.ndjson",
		`{"Kind":"meta","Code":"brileith","Tier":"MRD_1S","Player":"毛毛","StartedAtLocal":"2026-08-19T09:00:00+08:00"}`+"\n"+
			`{"EventId":1}`+"\n"+
			`{"Kind":"summary","SummaryVersion":2,"Fights":[`+
			`{"Stage":"MRD_1S","BossRace":7601,"BossName":"佩塔克","DurationSec":100,"PartySize":2,"Cleared":true,"Players":[`+
			`{"EntityId":"100","Name":"毛毛","Arcana":9,"Damage":6000,"Dps":60},`+
			`{"EntityId":"101","Name":"圓圓","Arcana":1,"Damage":3000,"Dps":30}]},`+
			`{"Stage":"MRD_2S","BossRace":7602,"BossName":"布倫塔納斯","DurationSec":200,"PartySize":2,"Players":[`+
			`{"EntityId":"100","Name":"毛毛","Arcana":9,"Damage":9000,"Dps":45}]}]}`+"\n")
	writeFile(t, dir, "dungeon_brileith_MRD_1S_b_20260819_080000.ndjson",
		`{"Kind":"meta","Code":"brileith","Tier":"MRD_1S","Player":"b","StartedAtLocal":"2026-08-19T08:00:00+08:00"}`+"\n"+
			`{"EventId":1}`+"\n")

	got, err := scanBattleRecords(dir)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("got %d records", len(got))
	}
	withSum, without := got[0], got[1]
	if len(withSum.Fights) != 2 {
		t.Fatalf("fights missing: %+v", withSum)
	}
	f1, f2 := withSum.Fights[0], withSum.Fights[1]
	if f1.BossName != "佩塔克" || f1.DurationSec != 100 || f1.PartySize != 2 {
		t.Fatalf("fight1 wrong: %+v", f1)
	}
	if f1.Cleared == nil || !*f1.Cleared {
		t.Fatalf("fight1 cleared wrong: %+v", f1)
	}
	// Owner columns come from matching meta.Player inside each fight.
	if f1.OwnerDps != 60 || f1.OwnerArcana != 9 || f2.OwnerDps != 45 {
		t.Fatalf("owner columns wrong: %+v %+v", f1, f2)
	}
	if without.Fights != nil {
		t.Fatalf("summary-less record must have no fights: %+v", without)
	}
}


// Backfill: summary-less closed files get a v2 summary appended (Cleared
// unknown without down events); v1 summaries are replaced in place; v2
// files and the currently-open file are untouched.
func TestBackfillSummaries(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir
	old := `{"Kind":"meta","Code":"brileith","Tier":"MRD_1S","Player":"毛毛","StartedAtLocal":"2026-08-01T09:00:00+08:00"}` + "\n" +
		`{"EventId":1,"At":1000,"Id":"100","Name":"毛毛","RaceId":10001,"OwnerId":""}` + "\n" +
		`{"EventId":1,"At":1000,"Id":"900","Name":"b","RaceId":7603,"OwnerId":""}` + "\n" +
		`{"EventId":3,"At":1000,"Id":"100","TargetId":"900","SkillId":59023,"Damage":500}` + "\n" +
		`{"EventId":3,"At":1100,"Id":"100","TargetId":"900","SkillId":59023,"Damage":500}` + "\n"
	writeFile(t, dir, "old.ndjson", old)
	writeFile(t, dir, "open.ndjson", old)
	writeFile(t, dir, "v1.ndjson", old+
		`{"Kind":"summary","BossRace":7603,"BossName":"雷楠的米勒","DurationSec":5,"PartySize":0}`+"\n")
	writeFile(t, dir, "v2.ndjson", old+
		`{"Kind":"summary","SummaryVersion":2,"Fights":[{"Stage":"MRD_3S","BossRace":7603,"BossName":"雷楠的米勒","DurationSec":7,"PartySize":1,"Players":[]}]}`+"\n")

	setOpenDungeonFile("open.ndjson")
	defer setOpenDungeonFile("")
	backfillSummaries(dir)

	recs, err := scanBattleRecords(dir)
	if err != nil {
		t.Fatal(err)
	}
	byFile := map[string]BattleRecord{}
	for _, r := range recs {
		byFile[r.File] = r
	}
	for _, name := range []string{"old.ndjson", "v1.ndjson"} {
		got := byFile[name]
		if len(got.Fights) != 1 {
			t.Fatalf("%s: fights missing: %+v", name, got)
		}
		f := got.Fights[0]
		// MRD_3S boss inside an MRD_1S-tier file must still be detected.
		if f.Stage != "MRD_3S" || f.BossName != "雷楠的米勒" || f.DurationSec != 100 || f.OwnerDps != 10 {
			t.Fatalf("%s: fight wrong: %+v", name, f)
		}
		if f.Cleared != nil {
			t.Fatalf("%s: Cleared must stay unknown", name)
		}
	}
	if byFile["open.ndjson"].Fights != nil {
		t.Fatal("open file must not be backfilled")
	}
	if got := byFile["v2.ndjson"]; len(got.Fights) != 1 || got.Fights[0].DurationSec != 7 {
		t.Fatalf("v2 file must be untouched: %+v", got)
	}
	// Idempotent: second run changes nothing.
	sizes := func() map[string]int64 {
		m := map[string]int64{}
		es, _ := os.ReadDir(dir)
		for _, e := range es {
			info, _ := e.Info()
			m[e.Name()] = info.Size()
		}
		return m
	}
	before := sizes()
	backfillSummaries(dir)
	after := sizes()
	for k, v := range before {
		if after[k] != v {
			t.Fatalf("second backfill changed %s", k)
		}
	}
}


func TestBattleNotesRoundTrip(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir
	writeFile(t, dir, "run.ndjson",
		`{"Kind":"meta","Code":"brileith","Tier":"MRD_3S","Player":"毛毛","StartedAtLocal":"2026-08-01T09:00:00+08:00"}`+"\n")

	rr := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/battles/note?file=run.ndjson", strings.NewReader(`{"note":"換了新裝備"}`))
	httpHandlerBattleNote(rr, req)
	if rr.Code != 204 {
		t.Fatalf("save note: %d %s", rr.Code, rr.Body.String())
	}

	recs, _ := scanBattleRecords(dir)
	if len(recs) != 1 || recs[0].Note != "換了新裝備" {
		t.Fatalf("note not in index: %+v", recs)
	}

	// empty note deletes the entry
	rr = httptest.NewRecorder()
	httpHandlerBattleNote(rr, httptest.NewRequest("POST", "/api/battles/note?file=run.ndjson", strings.NewReader(`{"note":""}`)))
	recs, _ = scanBattleRecords(dir)
	if recs[0].Note != "" {
		t.Fatal("empty note must clear")
	}
}

func TestBattleDeleteRemovesFileAndNote(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir
	writeFile(t, dir, "run.ndjson", `{"Kind":"meta","Code":"x","Tier":"t","Player":"p","StartedAtLocal":"2026-08-01T09:00:00+08:00"}`+"\n")

	orig := recycleFile
	defer func() { recycleFile = orig }()
	recycleFile = func(path string) error { return os.Remove(path) }

	rr := httptest.NewRecorder()
	httpHandlerBattleNote(rr, httptest.NewRequest("POST", "/api/battles/note?file=run.ndjson", strings.NewReader(`{"note":"n"}`)))

	rr = httptest.NewRecorder()
	httpHandlerBattleDelete(rr, httptest.NewRequest("POST", "/api/battles/delete?file=run.ndjson", nil))
	if rr.Code != 204 {
		t.Fatalf("delete: %d", rr.Code)
	}
	if _, err := os.Stat(filepath.Join(dir, "run.ndjson")); !os.IsNotExist(err) {
		t.Fatal("file must be gone")
	}
	if notes := loadBattleNotes(); notes["run.ndjson"] != "" {
		t.Fatal("note must be cleaned up")
	}

	rr = httptest.NewRecorder()
	httpHandlerBattleDelete(rr, httptest.NewRequest("GET", "/api/battles/delete?file=run.ndjson", nil))
	if rr.Code != 405 {
		t.Fatalf("GET must 405, got %d", rr.Code)
	}
}

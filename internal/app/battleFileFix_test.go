package app

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
)

func readAllBattle(t *testing.T, path string) string {
	t.Helper()
	rc, err := openBattleFile(path)
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	b, err := io.ReadAll(rc)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

// A client that listed the plain name before it was compressed still works.
func TestStalePlainNameResolvesToGz(t *testing.T) {
	dir := gzTestDir(t)
	const body = metaLine
	gzWrite(t, filepath.Join(dir, "r.ndjson.gz"), body)

	rr := httptest.NewRecorder()
	httpHandlerBattleContent(rr, httptest.NewRequest("GET", "/c?file=r.ndjson", nil))
	if rr.Code != 200 || rr.Body.String() != body {
		t.Fatalf("content code=%d body=%q", rr.Code, rr.Body.String())
	}

	got := ""
	orig := revealFile
	t.Cleanup(func() { revealFile = orig })
	revealFile = func(p string) error { got = p; return nil }
	rr = httptest.NewRecorder()
	httpHandlerBattleReveal(rr, httptest.NewRequest("POST", "/r?file=r.ndjson", nil))
	if rr.Code != 204 || got != filepath.Join(dir, "r.ndjson.gz") {
		t.Fatalf("reveal code=%d got=%q", rr.Code, got)
	}

	rr = httptest.NewRecorder()
	httpHandlerBattleNote(rr, httptest.NewRequest("POST", "/n?file=r.ndjson", strings.NewReader(`{"note":"hi"}`)))
	if rr.Code != 204 || loadBattleNotes()["r.ndjson.gz"] != "hi" {
		t.Fatalf("note code=%d notes=%v", rr.Code, loadBattleNotes())
	}

	origR := recycleFile
	t.Cleanup(func() { recycleFile = origR })
	recycleFile = os.Remove
	rr = httptest.NewRecorder()
	httpHandlerBattleDelete(rr, httptest.NewRequest("POST", "/d?file=r.ndjson", nil))
	if rr.Code != 204 || fileExists(filepath.Join(dir, "r.ndjson.gz")) || loadBattleNotes()["r.ndjson.gz"] != "" {
		t.Fatalf("delete code=%d", rr.Code)
	}
}

func TestThrottleFlushesPendingWhenWindowOpens(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir
	var d dungeonLog
	if err := d.Open("brileith", "NRD_1S", "p", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatal(err)
	}
	d.Write([]event.IEvent{mkOwnerStats(1000), mkOwnerStats(1003)})
	for at := int64(1004); at <= 1020; at++ {
		d.Write([]event.IEvent{mkDamage("1", "2", 1, 1, at)})
	}
	// Read the file before Close so the Close-time flush cannot mask it.
	names, _ := filepath.Glob(filepath.Join(dir, "*.ndjson"))
	b, _ := os.ReadFile(names[0])
	d.Close()
	var seq [][2]int64
	for _, l := range strings.Split(string(b), "\n") {
		if strings.Contains(l, `"Kind"`) || l == "" {
			continue
		}
		var e struct {
			EventId int64
			At      int64
		}
		if err := json.Unmarshal([]byte(l), &e); err != nil {
			t.Fatal(err)
		}
		seq = append(seq, [2]int64{e.EventId, e.At})
	}
	statsAt1003, firstLate := -1, -1
	for i, e := range seq {
		if e[0] == int64(event.EventIdOwnerStats) && e[1] == 1003 {
			statsAt1003 = i
		}
		if e[0] == int64(event.EventIdDamage) && e[1] >= 1013 && firstLate < 0 {
			firstLate = i
		}
	}
	if statsAt1003 < 0 || statsAt1003 > firstLate {
		t.Fatalf("stats@1003 at %d, first late damage at %d: %v", statsAt1003, firstLate, seq)
	}
}

func TestNotesRefuseToOverwriteCorruptFile(t *testing.T) {
	dir := gzTestDir(t)
	np := filepath.Join(dir, "notes.json")
	os.WriteFile(np, []byte("{ not json"), 0o644)
	if err := saveBattleNote("a.ndjson", "x"); err == nil {
		t.Fatal("expected refusal")
	}
	if b, _ := os.ReadFile(np); string(b) != "{ not json" {
		t.Fatal("corrupt notes.json was overwritten")
	}
	os.Remove(np)
	if err := saveBattleNote("a.ndjson", "x"); err != nil {
		t.Fatal(err)
	}
	if tmps, _ := filepath.Glob(filepath.Join(dir, "notes.json.*.tmp")); len(tmps) != 0 {
		t.Fatalf("temp left behind: %v", tmps)
	}
}

func TestSweepSetsAsideCorruptGzAndKeepsPlain(t *testing.T) {
	dir := gzTestDir(t)
	p := filepath.Join(dir, "r.ndjson")
	os.WriteFile(p, []byte(metaLine), 0o644)
	os.WriteFile(p+".gz", []byte("this is not gzip"), 0o644)
	// An unreadable twin must not hide the plain record from the index.
	recs, _ := scanBattleRecords(dir)
	if len(recs) != 1 || recs[0].File != "r.ndjson" {
		t.Fatalf("index = %+v", recs)
	}
	sweepBattleFiles(context.Background(), dir, func() string { return "" })
	// The plain record is kept; the same sweep may then compress it afresh.
	if !fileExists(p+".gz.corrupt") {
		t.Fatal("corrupt gz must be set aside")
	}
	if fileExists(p) {
		return
	}
	if got := readAllBattle(t, p+".gz"); !strings.HasPrefix(got, strings.TrimSpace(metaLine)) {
		t.Fatalf("record content lost: %q", got)
	}
}

func TestSweepKeepsBothWhenSizesDiffer(t *testing.T) {
	dir := gzTestDir(t)
	p := filepath.Join(dir, "r.ndjson")
	other := filepath.Join(dir, "o.ndjson")
	os.WriteFile(other, []byte("short\n"), 0o644)
	if _, err := compressBattleFile(other); err != nil {
		t.Fatal(err)
	}
	os.Rename(other+".gz", p+".gz")
	os.WriteFile(p, []byte(metaLine+"longer than the gz content\n"), 0o644)
	sweepBattleFiles(context.Background(), dir, func() string { return "" })
	if !fileExists(p) || !fileExists(p+".gz") {
		t.Fatal("size mismatch must keep both files")
	}
}

// The sweep must not compress anything while a real dungeon record is open.
func TestSweepWaitsForOpenDungeonRecord(t *testing.T) {
	dir := gzTestDir(t)
	dungeonGzipEnabled = false
	old := sweepPoll
	sweepPoll = 5 * time.Millisecond
	t.Cleanup(func() { sweepPoll = old })
	done := filepath.Join(dir, "done.ndjson")
	os.WriteFile(done, []byte(metaLine+sumLine), 0o644)

	var d dungeonLog
	if err := d.Open("brileith", "NRD_1S", "p", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatal(err)
	}
	live := getOpenDungeonFile()
	finished := make(chan struct{})
	go func() {
		sweepBattleFiles(context.Background(), dir, getOpenDungeonFile)
		close(finished)
	}()
	time.Sleep(100 * time.Millisecond)
	if !fileExists(done) || !fileExists(filepath.Join(dir, live)) {
		t.Fatal("sweep touched files while a record was open")
	}
	d.Close()
	select {
	case <-finished:
	case <-time.After(10 * time.Second):
		t.Fatal("sweep did not resume after the record closed")
	}
	if fileExists(done) || !fileExists(done+".gz") {
		t.Fatal("finished record should have been compressed after the wait")
	}
}

func TestIndexReadsGzHeaderWithoutBody(t *testing.T) {
	dir := gzTestDir(t)
	p := filepath.Join(dir, "r.ndjson")
	os.WriteFile(p, []byte(metaLine+strings.Repeat(`{"EventId":1}`+"\n", 5000)+sumLine), 0o644)
	gz, err := compressBattleFile(p)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(gz)
	os.WriteFile(gz, b[:len(b)/2], 0o644) // body gone, header intact
	recs, _ := scanBattleRecords(dir)
	if len(recs) != 1 || recs[0].Code != "brileith" {
		t.Fatalf("header-only read failed: %+v", recs)
	}
}

func TestGzSummaryUpgrade(t *testing.T) {
	dir := gzTestDir(t)
	p := filepath.Join(dir, "r.ndjson")
	old := `{"Kind":"summary","SummaryVersion":1}` + "\n"
	os.WriteFile(p, []byte(metaLine+`{"EventId":1}`+"\n"+old), 0o644)
	gz, err := compressBattleFile(p)
	if err != nil {
		t.Fatal(err)
	}
	mt := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	os.Chtimes(gz, mt, mt)
	backfillSummaries(dir)
	got := readAllBattle(t, gz)
	if strings.Count(got, `"Kind":"summary"`) != 1 || strings.Contains(got, `"SummaryVersion":1}`) ||
		!strings.Contains(got, `"EventId":1`) || !strings.HasPrefix(got, strings.TrimSpace(metaLine)) {
		t.Fatalf("upgrade result: %q", got)
	}
	rc, _ := openGzBattleReader(gz)
	_, sum, ok := parseGzExtra(rc.Extra())
	rc.Close()
	if !ok || sum.SummaryVersion != summaryVersion {
		t.Fatalf("header not refreshed: ok=%v sum=%+v", ok, sum)
	}
	if st, _ := os.Stat(gz); !st.ModTime().Equal(mt) {
		t.Fatalf("mtime = %v, want preserved %v", st.ModTime(), mt)
	}
	if tmps, _ := filepath.Glob(filepath.Join(dir, "*.tmp")); len(tmps) != 0 {
		t.Fatalf("temp left: %v", tmps)
	}
}

func TestCompressKeepsOriginalWhenVerificationFails(t *testing.T) {
	dir := gzTestDir(t)
	p := filepath.Join(dir, "r.ndjson")
	os.WriteFile(p, []byte(metaLine+sumLine), 0o644)
	compressPreVerifyHook = func(tmp string) {
		b, _ := os.ReadFile(tmp)
		os.WriteFile(tmp, b[:len(b)-6], 0o644)
	}
	t.Cleanup(func() { compressPreVerifyHook = nil })
	if _, err := compressBattleFile(p); err == nil {
		t.Fatal("expected verification failure")
	}
	if !fileExists(p) || fileExists(p+".gz") {
		t.Fatal("original must stay and no gz may appear")
	}
	if tmps, _ := filepath.Glob(filepath.Join(dir, "*.tmp")); len(tmps) != 0 {
		t.Fatalf("temp left: %v", tmps)
	}
}

func TestCompressPreservesMtimeAndWritesHeader(t *testing.T) {
	dir := gzTestDir(t)
	p := filepath.Join(dir, "r.ndjson")
	os.WriteFile(p, []byte(metaLine+sumLine), 0o644)
	mt := time.Date(2025, 5, 6, 7, 8, 9, 0, time.UTC)
	os.Chtimes(p, mt, mt)
	gz, err := compressBattleFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if st, _ := os.Stat(gz); !st.ModTime().Equal(mt) {
		t.Fatalf("mtime = %v, want %v", st.ModTime(), mt)
	}
	rc, _ := openGzBattleReader(gz)
	defer rc.Close()
	if m, _, ok := parseGzExtra(rc.Extra()); !ok || m.Code != "brileith" {
		t.Fatal("gzip header must carry meta and summary")
	}
}

func TestSweepRemovesRandomTempNames(t *testing.T) {
	dir := gzTestDir(t)
	for _, n := range []string{"a.ndjson.gz.12345.tmp", "b.ndjson.gz.tmp"} {
		os.WriteFile(filepath.Join(dir, n), []byte("x"), 0o644)
	}
	sweepBattleFiles(context.Background(), dir, func() string { return "" })
	if tmps, _ := filepath.Glob(filepath.Join(dir, "*.tmp")); len(tmps) != 0 {
		t.Fatalf("left: %v", tmps)
	}
}

func TestCloseSkipsGzipWhenSummaryWriteFails(t *testing.T) {
	dir := gzTestDir(t)
	var d dungeonLog
	if err := d.Open("brileith", "NRD_1S", "p", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatal(err)
	}
	d.fd.Close() // every later write fails
	d.Close()
	d.waitCompress()
	if gz, _ := filepath.Glob(filepath.Join(dir, "*.gz")); len(gz) != 0 {
		t.Fatalf("a record without its summary must stay plain: %v", gz)
	}
}

func TestBackfillSkipsOpenRecord(t *testing.T) {
	dir := gzTestDir(t)
	p := filepath.Join(dir, "live.ndjson")
	os.WriteFile(p, []byte(metaLine+`{"EventId":1}`+"\n"), 0o644)
	setOpenDungeonFile("live.ndjson")
	t.Cleanup(func() { setOpenDungeonFile("") })
	before, _ := os.ReadFile(p)
	backfillOne(p)
	after, _ := os.ReadFile(p)
	if !bytes.Equal(before, after) {
		t.Fatal("backfill must not touch the open record")
	}
}

func TestHeaderlessMarkerFollowsFileIdentity(t *testing.T) {
	p := filepath.Join(t.TempDir(), "x.ndjson.gz")
	if err := os.WriteFile(p, []byte("a"), 0o644); err != nil {
		t.Fatal(err)
	}
	if isMarkedHeaderless(p) {
		t.Fatal("unmarked file reported headerless")
	}
	markHeaderless(p)
	if !isMarkedHeaderless(p) {
		t.Fatal("marked file not reported headerless")
	}
	if err := os.WriteFile(p, []byte("abc"), 0o644); err != nil {
		t.Fatal(err)
	}
	if isMarkedHeaderless(p) {
		t.Fatal("a rewritten file must not keep the marker")
	}
}

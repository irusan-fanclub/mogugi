package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
)

// synthNdjson builds roughly n bytes of damage-like lines.
func synthNdjson(n int) []byte {
	rng := rand.New(rand.NewSource(1))
	var buf bytes.Buffer
	for buf.Len() < n {
		fmt.Fprintf(&buf, `{"EventId":3,"At":%d,"Id":"%d","TargetId":"%d","SkillId":%d,"Damage":%.1f,"IsCritical":%v}`+"\n",
			1700000000+rng.Intn(3600), 1000000+rng.Intn(50), 2000000+rng.Intn(20), rng.Intn(400), rng.Float64()*90000, rng.Intn(2) == 0)
	}
	return buf.Bytes()
}

func TestCompressBattleFileRoundTrip(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir
	p := filepath.Join(dir, "run.ndjson")
	data := synthNdjson(100 << 10)
	if err := os.WriteFile(p, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := saveBattleNote("run.ndjson", "hello"); err != nil {
		t.Fatal(err)
	}
	gz, err := compressBattleFile(p)
	if err != nil || gz != p+".gz" {
		t.Fatalf("gz=%q err=%v", gz, err)
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatal("original must be removed")
	}
	if _, err := os.Stat(gz + ".tmp"); !os.IsNotExist(err) {
		t.Fatal("temp must be gone")
	}
	r, err := openBattleFile(gz)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	got, _ := io.ReadAll(r)
	if !bytes.Equal(got, data) {
		t.Fatal("content did not round-trip")
	}
	notes := loadBattleNotes()
	if notes["run.ndjson.gz"] != "hello" || notes["run.ndjson"] != "" {
		t.Fatalf("note did not follow rename: %v", notes)
	}
}

func TestOpenBattleFilePlain(t *testing.T) {
	p := filepath.Join(t.TempDir(), "a.ndjson")
	os.WriteFile(p, []byte("x\n"), 0o644)
	r, err := openBattleFile(p)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	if b, _ := io.ReadAll(r); string(b) != "x\n" {
		t.Fatalf("got %q", b)
	}
}

// Measures gzip of a 40 MB record, which decides whether Close may compress
// inline. Run with -v to see the time.
func TestCompressBattleFile40MBTiming(t *testing.T) {
	if testing.Short() {
		t.Skip()
	}
	dir := t.TempDir()
	dungeonLogDirPath = dir
	p := filepath.Join(dir, "big.ndjson")
	if err := os.WriteFile(p, synthNdjson(40<<20), 0o644); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	gz, err := compressBattleFile(p)
	if err != nil {
		t.Fatal(err)
	}
	st, _ := os.Stat(gz)
	el := time.Since(start)
	t.Logf("gzip 40 MB -> %d bytes in %v", st.Size(), el)
	if el > 3*time.Second {
		t.Fatalf("compress took %v, want < 3s", el)
	}
}

// Existing dungeon-log tests read the plain file right after Close; the gzip
// tests below switch it back on.
func init() { dungeonGzipEnabled = false }

func gzTestDir(t *testing.T) string {
	dir := t.TempDir()
	dungeonLogDirPath = dir
	dungeonGzipEnabled = true
	t.Cleanup(func() { dungeonGzipEnabled = false })
	return dir
}

func gzWrite(t *testing.T, path, content string) {
	t.Helper()
	plain := path[:len(path)-3]
	if err := os.WriteFile(plain, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := compressBattleFile(plain); err != nil {
		t.Fatal(err)
	}
}

func TestDungeonLogGzipsOnClose(t *testing.T) {
	dir := gzTestDir(t)
	var d dungeonLog
	if err := d.Open("brileith", "NRD_1S", "p", time.Unix(1786800000, 0), 717000, "", "tw169", nil); err != nil {
		t.Fatal(err)
	}
	d.Write([]event.IEvent{mkDamage("1", "2", 1, 5, 1000)})
	d.Close()
	d.waitCompress()
	if plain, _ := filepath.Glob(filepath.Join(dir, "*.ndjson")); len(plain) != 0 {
		t.Fatalf("plain file left behind: %v", plain)
	}
	gz, _ := filepath.Glob(filepath.Join(dir, "*.ndjson.gz"))
	if len(gz) != 1 {
		t.Fatalf("got %v", gz)
	}
	r, err := openBattleFile(gz[0])
	if err != nil {
		t.Fatal(err)
	}
	defer r.Close()
	b, _ := io.ReadAll(r)
	lines := strings.Split(strings.TrimSpace(string(b)), "\n")
	if len(lines) != 3 || !strings.Contains(lines[0], `"Kind":"meta"`) || !strings.Contains(lines[2], `"summary"`) {
		t.Fatalf("bad content: %q", b)
	}
}

func TestScanBattleRecordsListsGz(t *testing.T) {
	dir := gzTestDir(t)
	gzWrite(t, filepath.Join(dir, "run.ndjson.gz"),
		`{"Kind":"meta","Code":"brileith","Tier":"NRD_1S","Player":"a","StartedAtLocal":"2026-08-17T09:00:00+08:00","Client":"tw169"}`+"\n"+
			`{"EventId":1}`+"\n"+
			`{"Kind":"summary","SummaryVersion":1,"Fights":[{"Stage":"MRD_1S","BossName":"b"}]}`+"\n")
	recs, err := scanBattleRecords(dir)
	if err != nil || len(recs) != 1 {
		t.Fatalf("recs=%v err=%v", recs, err)
	}
	r := recs[0]
	if r.File != "run.ndjson.gz" || r.Code != "brileith" || r.Player != "a" || r.Client != "tw169" || len(r.Fights) != 1 || r.SizeBytes == 0 {
		t.Fatalf("bad record: %+v", r)
	}
	// Second scan hits the cache and still gets the note applied.
	_ = saveBattleNote("run.ndjson.gz", "n")
	recs, _ = scanBattleRecords(dir)
	if recs[0].Note != "n" || len(recs[0].Fights) != 1 {
		t.Fatalf("cached scan: %+v", recs[0])
	}
}

func TestBattleContentServesDecompressedGz(t *testing.T) {
	dir := gzTestDir(t)
	const body = "{\"Kind\":\"meta\"}\n{\"EventId\":1}\n"
	gzWrite(t, filepath.Join(dir, "run.ndjson.gz"), body)
	rr := httptest.NewRecorder()
	httpHandlerBattleContent(rr, httptest.NewRequest("GET", "/api/battles/content?file=run.ndjson.gz", nil))
	if rr.Code != 200 || rr.Body.String() != body {
		t.Fatalf("code=%d body=%q", rr.Code, rr.Body.String())
	}
}

func TestValidBattleFileGz(t *testing.T) {
	dir := gzTestDir(t)
	gzWrite(t, filepath.Join(dir, "x.ndjson.gz"), "{}\n")
	os.WriteFile(filepath.Join(dir, "x.gz"), []byte("z"), 0o644)
	os.WriteFile(filepath.Join(filepath.Dir(dir), "x.ndjson.gz"), []byte("z"), 0o644)
	if _, ok := validBattleFile("x.ndjson.gz"); !ok {
		t.Fatal("x.ndjson.gz must be accepted")
	}
	for _, n := range []string{"../x.ndjson.gz", `..\x.ndjson.gz`, "x.gz"} {
		if _, ok := validBattleFile(n); ok {
			t.Fatalf("%q must be rejected", n)
		}
	}
}

func TestBackfillLeavesCurrentGzAlone(t *testing.T) {
	dir := gzTestDir(t)
	p := filepath.Join(dir, "run.ndjson")
	os.WriteFile(p, []byte(metaLine+`{"EventId":1}`+"\n"+sumLine), 0o644)
	if _, err := compressBattleFile(p); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(p + ".gz")
	backfillSummaries(dir)
	after, _ := os.ReadFile(p + ".gz")
	if !bytes.Equal(before, after) {
		t.Fatal("a current gz must not be rewritten")
	}
	if names, _ := filepath.Glob(filepath.Join(dir, "*.ndjson")); len(names) != 0 {
		t.Fatalf("backfill created %v", names)
	}
}

func TestReplayGzDeliversEventsAndClient(t *testing.T) {
	c, pub, _ := sourceFixture(t)
	dir := gzTestDir(t)
	const n = 20
	var sb strings.Builder
	sb.WriteString(`{"Kind":"meta","Code":"brileith","Tier":"NRD_1S","Player":"a","StartedAtLocal":"2026-08-17T09:00:00+08:00","Client":"tw169"}` + "\n")
	for _, e := range damageEvents(n) {
		b, _ := json.Marshal(e)
		sb.Write(b)
		sb.WriteByte('\n')
	}
	file := filepath.Join(dir, "run.ndjson.gz")
	gzWrite(t, file, sb.String())
	client := make(chan []event.IEvent, 1000)
	pub.addClient(context.Background(), client)
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	if got := collectDamage(client, n, 10*time.Second); len(got) != n {
		t.Fatalf("got %d damage events, want %d", len(got), n)
	}
	waitFinished(t, c)
	st := c.State()
	if st.Err != "" || st.ClientVersion != "tw169" || st.Done != st.Total {
		t.Fatalf("bad state: %+v", st)
	}
}

const metaLine = `{"Kind":"meta","Code":"brileith","Tier":"NRD_1S","Player":"a","StartedAtLocal":"2026-08-17T09:00:00+08:00"}` + "\n"
var sumLine = fmt.Sprintf(`{"Kind":"summary","SummaryVersion":%d}`+"\n", summaryVersion)

func TestReopenAfterCompressKeepsBothRecords(t *testing.T) {
	dir := gzTestDir(t)
	at := time.Unix(1786800000, 0)
	var d dungeonLog
	if err := d.Open("brileith", "NRD_1S", "p", at, 717000, "", "", nil); err != nil {
		t.Fatal(err)
	}
	d.Close()
	d.waitCompress()
	if err := d.Open("brileith", "NRD_1S", "p", at, 717000, "", "", nil); err != nil {
		t.Fatal(err)
	}
	d.Close()
	d.waitCompress()
	gz, _ := filepath.Glob(filepath.Join(dir, "*.ndjson.gz"))
	if len(gz) != 2 || !strings.HasSuffix(gz[0]+gz[1], "_2.ndjson.gz") && !strings.Contains(gz[0]+gz[1], "_2.ndjson.gz") {
		t.Fatalf("want two distinct gz records, got %v", gz)
	}
}

func TestCompressRefusesToOverwriteGz(t *testing.T) {
	dir := gzTestDir(t)
	p := filepath.Join(dir, "r.ndjson")
	os.WriteFile(p, []byte("new\n"), 0o644)
	os.WriteFile(p+".gz", []byte("old"), 0o644)
	if _, err := compressBattleFile(p); err == nil {
		t.Fatal("expected conflict error")
	}
	if b, _ := os.ReadFile(p + ".gz"); string(b) != "old" {
		t.Fatal("existing gz was clobbered")
	}
	if !fileExists(p) {
		t.Fatal("plain file must stay")
	}
}

func TestCompressRemoveFailureKeepsBothAndSweepResolves(t *testing.T) {
	dir := gzTestDir(t)
	p := filepath.Join(dir, "r.ndjson")
	os.WriteFile(p, []byte(metaLine+sumLine), 0o644)
	saveBattleNote("r.ndjson", "keep")
	origRm, origDelay := removeBattleFile, removeRetryDelay
	t.Cleanup(func() { removeBattleFile, removeRetryDelay = origRm, origDelay })
	removeRetryDelay = 0
	calls := 0
	removeBattleFile = func(string) error { calls++; return fmt.Errorf("sharing violation") }
	if _, err := compressBattleFile(p); err == nil || calls != 4 {
		t.Fatalf("err=%v calls=%d, want failure after 4 tries", err, calls)
	}
	if !fileExists(p) || !fileExists(p+".gz") {
		t.Fatal("both files must remain")
	}
	if loadBattleNotes()["r.ndjson.gz"] != "keep" {
		t.Fatal("note must already follow the rename")
	}
	removeBattleFile = origRm
	sweepBattleFiles(context.Background(), dir, func() string { return "" })
	if fileExists(p) || !fileExists(p+".gz") {
		t.Fatal("sweep must drop the plain twin of a valid gz")
	}
}

func TestDeleteDuringCompressDoesNotResurrect(t *testing.T) {
	dir := gzTestDir(t)
	p := filepath.Join(dir, "r.ndjson")
	os.WriteFile(p, []byte(metaLine), 0o644)
	compressTestHook = func() { os.Remove(p) }
	t.Cleanup(func() { compressTestHook = nil })
	if _, err := compressBattleFile(p); err == nil {
		t.Fatal("expected error")
	}
	for _, f := range []string{p, p + ".gz", p + ".gz.tmp"} {
		if fileExists(f) {
			t.Fatalf("%s must not exist", f)
		}
	}
}

func TestDeleteHandlerRemovesTwin(t *testing.T) {
	dir := gzTestDir(t)
	os.WriteFile(filepath.Join(dir, "r.ndjson"), []byte("x"), 0o644)
	os.WriteFile(filepath.Join(dir, "r.ndjson.gz"), []byte("x"), 0o644)
	orig := recycleFile
	t.Cleanup(func() { recycleFile = orig })
	recycleFile = os.Remove
	rr := httptest.NewRecorder()
	httpHandlerBattleDelete(rr, httptest.NewRequest("POST", "/api/battles/delete?file=r.ndjson", nil))
	if rr.Code != 204 || fileExists(filepath.Join(dir, "r.ndjson.gz")) || fileExists(filepath.Join(dir, "r.ndjson")) {
		t.Fatalf("code=%d, twin must go too", rr.Code)
	}
}

func TestSweepBattleFiles(t *testing.T) {
	dir := gzTestDir(t)
	w := func(n, c string) { os.WriteFile(filepath.Join(dir, n), []byte(c), 0o644) }
	w("stale.ndjson.gz.tmp", "junk")
	w("done.ndjson", metaLine+sumLine)
	w("nosum.ndjson", metaLine+`{"EventId":1}`+"\n")
	w("junk.ndjson", "not json\n")
	sweepBattleFiles(context.Background(), dir, func() string { return "" })
	if fileExists(filepath.Join(dir, "stale.ndjson.gz.tmp")) {
		t.Fatal("stale tmp must go")
	}
	for _, n := range []string{"done", "nosum"} {
		if fileExists(filepath.Join(dir, n+".ndjson")) || !fileExists(filepath.Join(dir, n+".ndjson.gz")) {
			t.Fatalf("%s must be compressed", n)
		}
	}
	if !fileExists(filepath.Join(dir, "junk.ndjson")) {
		t.Fatal("headerless files must stay plain")
	}
}

func TestSweepStopsOnCancel(t *testing.T) {
	dir := gzTestDir(t)
	os.WriteFile(filepath.Join(dir, "a.ndjson"), []byte(metaLine+sumLine), 0o644)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	sweepBattleFiles(ctx, dir, func() string { return "" })
	if !fileExists(filepath.Join(dir, "a.ndjson")) {
		t.Fatal("cancelled sweep must not compress")
	}
}

func TestGzNamesCaseInsensitive(t *testing.T) {
	if !isGzBattleFile("A.NDJSON.GZ") || !isBattleFileName("A.NDJSON") {
		t.Fatal("suffix match must ignore case")
	}
}

func TestGzCacheIsPruned(t *testing.T) {
	dir := gzTestDir(t)
	f := filepath.Join(dir, "r.ndjson.gz")
	gzWrite(t, f, metaLine)
	scanBattleRecords(dir)
	n := func() int {
		c := 0
		gzRecordCache.Range(func(k, _ any) bool {
			if filepath.Dir(k.(gzRecordKey).path) == dir {
				c++
			}
			return true
		})
		return c
	}
	if n() != 1 {
		t.Fatalf("cache entries = %d, want 1", n())
	}
	os.Remove(f)
	scanBattleRecords(dir)
	if n() != 0 {
		t.Fatal("deleted file must leave the cache")
	}
}

func TestBattleContentAbortsOnCorruptGz(t *testing.T) {
	dir := gzTestDir(t)
	p := filepath.Join(dir, "r.ndjson.gz")
	gzWrite(t, p, strings.Repeat("{\"EventId\":1}\n", 10000))
	b, _ := os.ReadFile(p)
	os.WriteFile(p, b[:len(b)-12], 0o644) // truncated: bad trailer
	defer func() {
		if r := recover(); r != http.ErrAbortHandler {
			t.Fatalf("recover = %v, want ErrAbortHandler", r)
		}
	}()
	httpHandlerBattleContent(httptest.NewRecorder(), httptest.NewRequest("GET", "/api/battles/content?file=r.ndjson.gz", nil))
}

func countSummaries(t *testing.T, path string) int {
	t.Helper()
	rc, err := openBattleFile(path)
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	b, err := io.ReadAll(rc)
	if err != nil {
		t.Fatalf("unreadable: %v", err)
	}
	return strings.Count(string(b), `"Kind":"summary"`)
}

func TestConcurrentBackfillWritesOneSummary(t *testing.T) {
	dir := gzTestDir(t)
	p := filepath.Join(dir, "r.ndjson")
	os.WriteFile(p, []byte(metaLine+`{"EventId":1}`+"\n"), 0o644)
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); backfillOne(p) }()
	}
	wg.Wait()
	if n := countSummaries(t, p); n != 1 {
		t.Fatalf("summary lines = %d, want 1", n)
	}
}

func TestBackfillAndCompressNeverCorrupt(t *testing.T) {
	dir := gzTestDir(t)
	for i := 0; i < 20; i++ {
		name := fmt.Sprintf("r%d.ndjson", i)
		p := filepath.Join(dir, name)
		os.WriteFile(p, []byte(metaLine+`{"EventId":1}`+"\n"), 0o644)
		var wg sync.WaitGroup
		wg.Add(2)
		go func() { defer wg.Done(); backfillOne(p) }()
		go func() { defer wg.Done(); compressBattleFile(p) }()
		wg.Wait()
		if fileExists(p) && fileExists(p+".gz") || fileExists(p+".gz.tmp") {
			t.Fatalf("%s: stray files", name)
		}
		if fileExists(p + ".gz") {
			if n := countSummaries(t, p+".gz"); n > 1 {
				t.Fatalf("%s: %d summaries in gz", name, n)
			}
		} else if n := countSummaries(t, p); n != 1 {
			t.Fatalf("%s: plain has %d summaries", name, n)
		}
	}
}

// Backfill first, then compress: the summary ends up inside the gz.
func TestBackfillThenCompressKeepsSummary(t *testing.T) {
	dir := gzTestDir(t)
	p := filepath.Join(dir, "r.ndjson")
	os.WriteFile(p, []byte(metaLine+`{"EventId":1}`+"\n"), 0o644)
	backfillOne(p)
	gz, err := compressBattleFile(p)
	if err != nil || countSummaries(t, gz) != 1 {
		t.Fatalf("err=%v, want one summary in gz", err)
	}
}

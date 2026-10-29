package app

import (
	"archive/zip"
	"encoding/json"
	"fmt"
	"net"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/irusan-fanclub/mogugi/lib/util"
)

func writeSized(t *testing.T, path string, n int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, make([]byte, n), 0o644); err != nil {
		t.Fatal(err)
	}
}

// logsFixture builds a logs dir with matching, current-session and foreign files.
func logsFixture(t *testing.T) string {
	dir := withAppConfigDir(t)
	oldPL := packetLogPath()
	t.Cleanup(func() { setPacketLogPath(oldPL) })
	l := filepath.Join(dir, "logs")
	cur := util.StartStamp
	setPacketLogPath(filepath.Join(l, "packet_log_"+cur+".ndjson"))
	writeSized(t, filepath.Join(l, "mogugi_20200101_000001.log"), 10)
	writeSized(t, filepath.Join(l, "mogugi_"+cur+".log"), 20)
	writeSized(t, filepath.Join(l, "packet_log_20200101_000001.ndjson"), 100)
	writeSized(t, packetLogPath(), 200)
	writeSized(t, filepath.Join(l, "debug_20200101_000001.zip"), 1000)
	writeSized(t, filepath.Join(l, "packet_capture_20200101_000001.pcapng"), 5000)
	writeSized(t, filepath.Join(l, "packet_capture_"+cur+".pcapng"), 7000)
	writeSized(t, filepath.Join(l, "dungeons", "x.ndjson"), 99999)
	writeSized(t, filepath.Join(l, "items_log", "y.log"), 99999)
	writeSized(t, filepath.Join(l, "other.txt"), 99999)
	writeSized(t, filepath.Join(dir, "mogugi_20200101_000001.log"), 99999)
	return dir
}

func TestLogUsageSumsOnlyMatchingPatterns(t *testing.T) {
	logsFixture(t)
	logB, pcapB := logUsage()
	if logB != 10+20+100+200+1000 {
		t.Fatalf("logBytes=%d", logB)
	}
	if pcapB != 12000 {
		t.Fatalf("pcapBytes=%d", pcapB)
	}
}

func stubRecycle(t *testing.T) *[]string {
	return stubRecycleFailing(t, "")
}

// stubRecycleFailing removes files for real but reports failure for one base name.
func stubRecycleFailing(t *testing.T, failName string) *[]string {
	var got []string
	orig := recycleFiles
	t.Cleanup(func() { recycleFiles = orig })
	recycleFiles = func(paths []string) ([]int, error) {
		var failed []int
		for i, p := range paths {
			if filepath.Base(p) == failName {
				failed = append(failed, i)
				continue
			}
			got = append(got, filepath.Base(p))
			os.Remove(p)
		}
		return failed, nil
	}
	return &got
}

func TestClearContinuesPastFailure(t *testing.T) {
	logsFixture(t)
	stubRecycleFailing(t, "mogugi_20200101_000001.log")
	freed, failed, err := clearLogs("log")
	if err != nil || freed != 100+1000 || len(failed) != 1 || failed[0] != "mogugi_20200101_000001.log" {
		t.Fatalf("freed=%d failed=%v err=%v", freed, failed, err)
	}
	rr := httptest.NewRecorder()
	httpHandlerLogsClear(rr, httptest.NewRequest("POST", "/api/logs/clear?kind=log", nil))
	if rr.Code != 207 || strings.TrimSpace(rr.Body.String()) != `{"failed":["mogugi_20200101_000001.log"],"freedBytes":0}` {
		t.Fatal(rr.Code, rr.Body.String())
	}
}

func TestUsageIgnoresLookalikesAndBracketDirs(t *testing.T) {
	dir := logsFixture(t)
	l := filepath.Join(dir, "logs")
	writeSized(t, filepath.Join(l, "mogugi_notes.log"), 7777)
	writeSized(t, filepath.Join(l, "debug_mine.zip"), 7777)
	writeSized(t, filepath.Join(l, "packet_capture_mine.pcapng"), 7777)
	if lb, pb := logUsage(); lb != 1330 || pb != 12000 {
		t.Fatalf("lookalikes counted: %d %d", lb, pb)
	}
}

func TestUsageInBracketedInstallDir(t *testing.T) {
	old := dataDirOverride
	t.Cleanup(func() { dataDirOverride = old })
	dataDirOverride = filepath.Join(t.TempDir(), "a[x] b[1]")
	writeSized(t, filepath.Join(dataDirOverride, "logs", "mogugi_20200101_000001.log"), 42)
	if lb, _ := logUsage(); lb != 42 {
		t.Fatalf("bracket path broke matching: %d", lb)
	}
}

func TestPackUniqueNameOnSameStamp(t *testing.T) {
	logsFixture(t)
	orig := revealFile
	t.Cleanup(func() { revealFile = orig })
	revealFile = func(string) error { return nil }
	seen := map[string]bool{}
	for i := 0; i < 3; i++ {
		n, err := packLogs()
		if err != nil || seen[n] {
			t.Fatalf("dup or err: %q %v", n, err)
		}
		seen[n] = true
	}
}

func TestClearLogsSkipsCurrentSessionAndForeign(t *testing.T) {
	dir := logsFixture(t)
	got := stubRecycle(t)
	freed, _, err := clearLogs("log")
	if err != nil {
		t.Fatal(err)
	}
	if freed != 10+100+1000 {
		t.Fatalf("freed=%d", freed)
	}
	sort.Strings(*got)
	if strings.Join(*got, ",") != "debug_20200101_000001.zip,mogugi_20200101_000001.log,packet_log_20200101_000001.ndjson" {
		t.Fatalf("recycled %v", *got)
	}
	l := filepath.Join(dir, "logs")
	for _, keep := range []string{"mogugi_" + util.StartStamp + ".log", filepath.Base(packetLogPath()), "other.txt", "dungeons/x.ndjson", "items_log/y.log", "packet_capture_20200101_000001.pcapng"} {
		if _, err := os.Stat(filepath.Join(l, keep)); err != nil {
			t.Fatalf("%s should remain: %v", keep, err)
		}
	}
}

func TestClearPcapSkipsCurrentStamp(t *testing.T) {
	dir := logsFixture(t)
	stubRecycle(t)
	freed, _, err := clearLogs("pcap")
	if err != nil || freed != 5000 {
		t.Fatalf("freed=%d err=%v", freed, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "logs", "packet_capture_"+util.StartStamp+".pcapng")); err != nil {
		t.Fatal("current pcapng removed")
	}
	if _, _, err := clearLogs("bogus"); err == nil {
		t.Fatal("bad kind accepted")
	}
}

func TestPackLogsZipContents(t *testing.T) {
	dir := logsFixture(t)
	l := filepath.Join(dir, "logs")
	for _, s := range []string{"20200102", "20200103", "20200104"} {
		writeSized(t, filepath.Join(l, "mogugi_"+s+"_000000.log"), 1)
	}
	writeSized(t, filepath.Join(dir, appConfigFileName), 5)
	writeSized(t, filepath.Join(dir, "license.dat"), 5)
	writeSized(t, filepath.Join(l, "license.key"), 5)
	var revealed string
	orig := revealFile
	t.Cleanup(func() { revealFile = orig })
	revealFile = func(p string) error { revealed = p; return nil }

	name, err := packLogs()
	if err != nil {
		t.Fatal(err)
	}
	if revealed != filepath.Join(l, name) || !strings.HasPrefix(name, "debug_") || !strings.HasSuffix(name, ".zip") {
		t.Fatalf("name=%s revealed=%s", name, revealed)
	}
	zr, err := zip.OpenReader(revealed)
	if err != nil {
		t.Fatal(err)
	}
	defer zr.Close()
	var names []string
	for _, f := range zr.File {
		names = append(names, f.Name)
	}
	sort.Strings(names)
	want := []string{"mogugi-config.toml", "mogugi_20200102_000000.log", "mogugi_20200103_000000.log", "mogugi_20200104_000000.log", "mogugi_" + util.StartStamp + ".log", filepath.Base(packetLogPath())}
	sort.Strings(want)
	if strings.Join(names, ",") != strings.Join(want, ",") {
		t.Fatalf("entries %v want %v", names, want)
	}
	for _, n := range names {
		if strings.Contains(strings.ToLower(n), "license") {
			t.Fatalf("license entry %s", n)
		}
	}
}

func TestLanURLsInjectedAddrs(t *testing.T) {
	orig := interfaceAddrs
	t.Cleanup(func() { interfaceAddrs = orig })
	interfaceAddrs = func() ([]net.Addr, error) {
		return []net.Addr{
			&net.IPNet{IP: net.ParseIP("127.0.0.1")},
			&net.IPNet{IP: net.ParseIP("192.168.1.5")},
			&net.IPNet{IP: net.ParseIP("fe80::1")},
			&net.IPAddr{IP: net.ParseIP("10.0.0.2")},
		}, nil
	}
	got := lanURLs(8031)
	if strings.Join(got, ",") != "http://192.168.1.5:8031/,http://10.0.0.2:8031/" {
		t.Fatalf("%v", got)
	}
}

func TestConfigGetHasLanUrls(t *testing.T) {
	withAppConfigDir(t)
	port = 8044
	orig := interfaceAddrs
	t.Cleanup(func() { interfaceAddrs = orig })
	interfaceAddrs = func() ([]net.Addr, error) {
		return []net.Addr{&net.IPNet{IP: net.ParseIP("192.168.0.9")}}, nil
	}
	rr := httptest.NewRecorder()
	httpHandlerConfig(rr, httptest.NewRequest("GET", "/api/config", nil))
	var raw struct {
		Effective struct {
			LanUrls []string `json:"lanUrls"`
		} `json:"effective"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &raw); err != nil {
		t.Fatal(err)
	}
	if len(raw.Effective.LanUrls) != 1 || raw.Effective.LanUrls[0] != "http://192.168.0.9:8044/" {
		t.Fatalf("%v", raw.Effective.LanUrls)
	}
}

func TestPacketWriterGatedBySavePacketLog(t *testing.T) {
	dir := withAppConfigDir(t)
	oldPL, oldRun := packetLogPath(), savePacketLogRun
	t.Cleanup(func() { setPacketLogPath(oldPL); savePacketLogRun = oldRun })
	setPacketLogPath("")
	savePacketLogRun = false
	runPacketWriter(t.Context(), nil)
	if packetLogPath() != "" {
		t.Fatal("writer started while disabled")
	}
	if _, err := os.Stat(filepath.Join(dir, "logs")); err == nil {
		t.Fatal("logs dir created while disabled")
	}
}

func TestLogEndpoints(t *testing.T) {
	dir := logsFixture(t)
	stubRecycle(t)
	var opened, revealed []string
	oo, or := openPath, revealFile
	t.Cleanup(func() { openPath, revealFile = oo, or })
	openPath = func(p string) error { opened = append(opened, p); return nil }
	revealFile = func(p string) error { revealed = append(revealed, p); return nil }

	rr := httptest.NewRecorder()
	httpHandlerLogsUsage(rr, httptest.NewRequest("GET", "/api/logs/usage", nil))
	if strings.TrimSpace(rr.Body.String()) != `{"logBytes":1330,"pcapBytes":12000}` {
		t.Fatal(rr.Body.String())
	}
	rr = httptest.NewRecorder()
	httpHandlerLogsClear(rr, httptest.NewRequest("POST", "/api/logs/clear?kind=pcap", nil))
	if strings.TrimSpace(rr.Body.String()) != `{"failed":[],"freedBytes":5000}` {
		t.Fatal(rr.Body.String())
	}
	rr = httptest.NewRecorder()
	httpHandlerLogsClear(rr, httptest.NewRequest("POST", "/api/logs/clear?kind=x", nil))
	if rr.Code != 400 {
		t.Fatal(rr.Code)
	}
	rr = httptest.NewRecorder()
	httpHandlerLogsPack(rr, httptest.NewRequest("POST", "/api/logs/pack", nil))
	if !strings.HasPrefix(rr.Body.String(), `{"name":"debug_`) {
		t.Fatal(rr.Body.String())
	}
	rr = httptest.NewRecorder()
	httpHandlerLogsOpen(rr, httptest.NewRequest("POST", "/api/logs/open", nil))
	rr2 := httptest.NewRecorder()
	httpHandlerConfigOpen(rr2, httptest.NewRequest("POST", "/api/files/config/open", nil))
	rr3 := httptest.NewRecorder()
	httpHandlerConfigReveal(rr3, httptest.NewRequest("POST", "/api/files/config/reveal", nil))
	if rr.Code != 204 || rr2.Code != 204 || rr3.Code != 204 {
		t.Fatal(rr.Code, rr2.Code, rr3.Code)
	}
	if len(opened) != 2 || opened[0] != filepath.Join(dir, "logs") || opened[1] != appConfigPath() {
		t.Fatalf("opened %v", opened)
	}
	if len(revealed) != 2 || revealed[1] != appConfigPath() {
		t.Fatalf("revealed %v", revealed)
	}
	rr = httptest.NewRecorder()
	httpHandlerLogsPack(rr, httptest.NewRequest("GET", "/api/logs/pack", nil))
	if rr.Code != 405 {
		t.Fatal(rr.Code)
	}
}

func TestClearLogsRecyclesInChunks(t *testing.T) {
	dir := filepath.Join(withAppConfigDir(t), "logs")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	n := recycleChunk*2 + 5
	for i := 0; i < n; i++ {
		name := fmt.Sprintf("mogugi_20200101_%06d.log", i)
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	var calls []int
	old := recycleFiles
	recycleFiles = func(paths []string) ([]int, error) {
		calls = append(calls, len(paths))
		return nil, nil
	}
	t.Cleanup(func() { recycleFiles = old })
	freed, failed, err := clearLogs("log")
	if err != nil || len(failed) != 0 || freed != int64(n) {
		t.Fatalf("freed=%d failed=%v err=%v", freed, failed, err)
	}
	if len(calls) != 3 || calls[0] != recycleChunk || calls[2] != 5 {
		t.Fatalf("chunks = %v", calls)
	}
}

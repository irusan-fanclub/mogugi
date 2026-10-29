package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// battleFixturePcapng enters a dungeon and leaves it, so a replay that
// imports battles writes exactly one record.
func battleFixturePcapng(t *testing.T, path string) {
	t.Helper()
	synthPcapng(t, path,
		questInfoPacket(7, 717000, "布里萊赫"),
		setLocationPacket(1, 35001),
		setLocationPacket(1, 3100),
	)
}

func countBattleFiles(t *testing.T, dir string) int {
	t.Helper()
	m, _ := filepath.Glob(filepath.Join(dir, "*.ndjson"))
	return len(m)
}

func importFixture(t *testing.T) (*SourceController, string) {
	t.Helper()
	c, _, _ := sourceFixture(t)
	orig := dungeonLogDirPath
	dungeonLogDirPath = t.TempDir()
	t.Cleanup(func() { dungeonLogDirPath = orig })
	t.Cleanup(c.StopReplay)
	return c, dungeonLogDirPath
}

func replayAndWait(t *testing.T, c *SourceController, file string, imp bool) SourceState {
	t.Helper()
	if err := c.StartReplay(file, ReplayOptions{ImportBattles: imp}); err != nil {
		t.Fatal(err)
	}
	waitFinished(t, c)
	return c.State()
}

func TestImportBattlesOnce(t *testing.T) {
	c, dir := importFixture(t)
	file := filepath.Join(t.TempDir(), "cap.pcapng")
	battleFixturePcapng(t, file)

	if st := replayAndWait(t, c, file, true); st.Err != "" || st.Notice != "" {
		t.Fatalf("first import state=%+v", st)
	}
	k := countBattleFiles(t, dir)
	if k == 0 {
		t.Fatal("import wrote no battle record")
	}
	reg, err := loadImportRegistry(filepath.Join(dir, "imported.json"))
	if err != nil {
		t.Fatal(err)
	}
	sum, _ := hashFile(file)
	if !reg.Has(sum) {
		t.Fatal("hash not registered after clean replay")
	}

	st := replayAndWait(t, c, file, true)
	if n := countBattleFiles(t, dir); n != k {
		t.Fatalf("duplicate import wrote files: %d -> %d", k, n)
	}
	if st.Err != "" || st.Notice != importedNotice {
		t.Fatalf("dup state=%+v", st)
	}

	c.StopReplay()
	if st := replayAndWait(t, c, file, false); st.Notice != "" || st.Err != "" {
		t.Fatalf("no-import state=%+v", st)
	}
	if n := countBattleFiles(t, dir); n != k {
		t.Fatalf("replay without import wrote files: %d -> %d", k, n)
	}
}

func TestImportFailureNotRegistered(t *testing.T) {
	c, dir := importFixture(t)
	file := filepath.Join(t.TempDir(), "cap.pcapng")
	battleFixturePcapng(t, file)
	b, _ := os.ReadFile(file)
	if err := os.WriteFile(file, b[:len(b)-40], 0o644); err != nil {
		t.Fatal(err)
	}
	if err := c.StartReplay(file, ReplayOptions{ImportBattles: true}); err != nil {
		t.Fatal(err)
	}
	waitReturnedLive(t, c)
	reg, _ := loadImportRegistry(filepath.Join(dir, "imported.json"))
	sum, _ := hashFile(file)
	if reg.Has(sum) {
		t.Fatal("failed replay was registered")
	}
}

func TestImportNoGameContentNotRegistered(t *testing.T) {
	c, dir := importFixture(t)
	file := filepath.Join(t.TempDir(), "cap.pcapng")
	synthPcapng(t, file) // valid capture, no game packets
	if err := c.StartReplay(file, ReplayOptions{ImportBattles: true}); err != nil {
		t.Fatal(err)
	}
	if st := waitReturnedLive(t, c); st.Err != errNoGameContent {
		t.Fatalf("err=%q", st.Err)
	}
	reg, _ := loadImportRegistry(filepath.Join(dir, "imported.json"))
	sum, _ := hashFile(file)
	if reg.Has(sum) {
		t.Fatal("replay without game content was registered")
	}
}

func TestImportStoppedNotRegistered(t *testing.T) {
	c, dir := importFixture(t)
	file := filepath.Join(t.TempDir(), "cap.pcapng")
	battleFixturePcapng(t, file)
	if err := c.StartReplay(file, ReplayOptions{ImportBattles: true}); err != nil {
		t.Fatal(err)
	}
	c.StopReplay()
	time.Sleep(300 * time.Millisecond)
	reg, _ := loadImportRegistry(filepath.Join(dir, "imported.json"))
	sum, _ := hashFile(file)
	if reg.Has(sum) {
		t.Fatal("stopped replay was registered")
	}
}

func TestImportNoticeAppendsToExisting(t *testing.T) {
	if got := joinNotice("a", importedNotice); got != "a"+importedNotice {
		t.Fatalf("got %q", got)
	}
	if got := joinNotice("", importedNotice); got != importedNotice {
		t.Fatalf("got %q", got)
	}
}

func TestImportRegistryCorruptBackedUp(t *testing.T) {
	path := filepath.Join(t.TempDir(), "imported.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	reg, err := loadImportRegistry(path)
	if err == nil || reg == nil {
		t.Fatalf("want error plus usable empty registry, got %v %v", reg, err)
	}
	if reg.Has("x") {
		t.Fatal("corrupt registry not empty")
	}
	if b, _ := os.ReadFile(path); string(b) != "{not json" {
		t.Fatal("corrupt file overwritten on load")
	}
	if err := reg.Add("abc", "f.pcapng", time.Now()); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(path + ".bak"); string(b) != "{not json" {
		t.Fatalf("backup missing or wrong: %q", b)
	}
	re, err := loadImportRegistry(path)
	if err != nil || !re.Has("abc") {
		t.Fatalf("reload: %v", err)
	}
}

func TestImportRegistryMissingAndRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sub", "imported.json")
	reg, err := loadImportRegistry(path)
	if err != nil || reg.Has("a") {
		t.Fatalf("missing file: %v", err)
	}
	at := time.Date(2026, 10, 21, 1, 2, 3, 0, time.UTC)
	if err := reg.Add("a", "x.pcapng", at); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(path)
	if !strings.Contains(string(b), `"file": "x.pcapng"`) || !strings.Contains(string(b), "2026-10-21T01:02:03Z") {
		t.Fatalf("format: %s", b)
	}
	if m, _ := filepath.Glob(path + "*.tmp"); len(m) != 0 {
		t.Fatalf("temp left: %v", m)
	}
}

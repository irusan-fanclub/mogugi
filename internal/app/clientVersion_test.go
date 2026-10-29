package app

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/pcaputil"
)

func TestBattleIndexCarriesClient(t *testing.T) {
	dir := t.TempDir()
	oldDir := dungeonLogDirPath
	t.Cleanup(func() { dungeonLogDirPath = oldDir })
	dungeonLogDirPath = dir
	var d dungeonLog
	if err := d.Open("brileith", "NRD_1S", "a", time.Unix(1786800000, 0), 717000, "", "tw169", nil); err != nil {
		t.Fatal(err)
	}
	d.Close()
	got, err := scanBattleRecords(dir)
	if err != nil || len(got) != 1 || got[0].Client != "tw169" {
		t.Fatalf("got %+v err=%v", got, err)
	}
}

func TestBattleIndexClientEmptyWhenUnset(t *testing.T) {
	dir := t.TempDir()
	oldDir := dungeonLogDirPath
	t.Cleanup(func() { dungeonLogDirPath = oldDir })
	dungeonLogDirPath = dir
	var d dungeonLog
	if err := d.Open("brileith", "NRD_1S", "a", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatal(err)
	}
	d.Close()
	if bytes.Contains(firstLine(t, dir), []byte(`"Client"`)) {
		t.Fatal("empty client must be omitted from the meta")
	}
	got, err := scanBattleRecords(dir)
	if err != nil || len(got) != 1 || got[0].Client != "" {
		t.Fatalf("got %+v err=%v", got, err)
	}
}

// firstLine returns the meta line of the only run file in dir.
func firstLine(t *testing.T, dir string) []byte {
	t.Helper()
	names, _ := filepath.Glob(filepath.Join(dir, "*.ndjson"))
	if len(names) != 1 {
		t.Fatalf("got %d files", len(names))
	}
	b, err := os.ReadFile(names[0])
	if err != nil {
		t.Fatal(err)
	}
	line, _, _ := bytes.Cut(b, []byte("\n"))
	return line
}

func TestPcapngReplayHasNoClientVersion(t *testing.T) {
	c, _, _ := sourceFixture(t)
	c.SetLiveClient("tw169")
	file := filepath.Join(t.TempDir(), "cap.pcapng")
	synthPcapng(t, file, snapshotPacket())
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	if st := c.State(); st.Mode != "replay" || st.ClientVersion != "" {
		t.Fatalf("replay start %+v", st)
	}
	waitFinished(t, c)
	if st := c.State(); st.ClientVersion != "" {
		t.Fatalf("replay end %+v", st)
	}
}

func TestLiveResetsKeepClientVersion(t *testing.T) {
	c, _, _ := sourceFixture(t)
	c.SetLiveClient("tw169")
	// fail: bad extension
	if err := c.StartReplay(filepath.Join(t.TempDir(), "x.txt"), ReplayOptions{}); err == nil {
		t.Fatal("expected error")
	}
	if st := c.State(); st.Mode != "live" || st.Err == "" || st.ClientVersion != "tw169" {
		t.Fatalf("fail %+v", st)
	}
	// returnLiveWithErrLocked: a replay with no game content
	file := filepath.Join(t.TempDir(), "junk.ndjson")
	if err := os.WriteFile(file, []byte(`{"EventId":999}`+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	st := waitReturnedLive(t, c)
	if st.Err == "" || st.ClientVersion != "tw169" {
		t.Fatalf("returnLive %+v", st)
	}
}

func TestDungeonOpenStampsLiveClient(t *testing.T) {
	for _, tc := range []struct {
		name     string
		readOnly bool
		want     string
	}{{"live", false, "tw169"}, {"import", true, ""}} {
		t.Run(tc.name, func(t *testing.T) {
			orig := dungeonLogDirPath
			dungeonLogDirPath = t.TempDir()
			defer func() { dungeonLogDirPath = orig }()
			p := &eventPublisher{entityCache: make(entityCache)}
			p.setLiveClient("tw169")
			if tc.readOnly {
				p.readOnly.Store(true)
				p.importBattles.Store(true)
			}
			p.handleQuestInfo(questInfoPacket(7, 717000, "布里萊赫"))
			p.handleSetLocation(setLocationPacket(1, 35001))
			if !p.dgnLog.IsOpen() {
				t.Fatal("log not open")
			}
			p.dgnLog.Close()
			var meta dungeonLogMeta
			if err := json.Unmarshal(firstLine(t, dungeonLogDirPath), &meta); err != nil {
				t.Fatal(err)
			}
			if meta.Client != tc.want {
				t.Fatalf("Client=%q want %q", meta.Client, tc.want)
			}
		})
	}
}

func TestNdjsonReplayMetaClient(t *testing.T) {
	c, _, _ := sourceFixture(t)
	file := writeNdjson(t, damageEvents(2)...)
	body, _ := os.ReadFile(file)
	meta := `{"Kind":"meta","Version":"1","Code":"x","Client":"tw169"}` + "\n"
	if err := os.WriteFile(file, append([]byte(meta), body...), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	waitFinished(t, c)
	if st := c.State(); st.ClientVersion != "tw169" || st.Err != "" {
		t.Fatalf("state %+v", st)
	}
}

func TestReplayStateOnlyLiveHasClient(t *testing.T) {
	c, _, _ := sourceFixture(t)
	c.SetLiveClient("tw169")
	if st := c.State(); st.Mode != "live" || st.ClientVersion != "tw169" {
		t.Fatalf("live %+v", st)
	}
	file := writeNdjson(t, damageEvents(1)...)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	waitFinished(t, c)
	if st := c.State(); st.ClientVersion != "" {
		t.Fatalf("replay without meta must not show the live value: %+v", st)
	}
	c.StopReplay()
	if st := c.State(); st.Mode != "live" || st.ClientVersion != "tw169" {
		t.Fatalf("back to live %+v", st)
	}
}

func TestSetLiveClientDuringReplayKeepsReplayState(t *testing.T) {
	c, _, _ := sourceFixture(t)
	file := writeNdjson(t, damageEvents(1)...)
	t.Cleanup(c.StopReplay)
	if err := c.StartReplay(file, ReplayOptions{}); err != nil {
		t.Fatal(err)
	}
	waitFinished(t, c)
	c.SetLiveClient("kr100")
	if st := c.State(); st.ClientVersion != "" {
		t.Fatalf("%+v", st)
	}
}

func TestLiveOpenClientBlankWhileReplaying(t *testing.T) {
	p := &eventPublisher{}
	p.setLiveClient("tw169")
	if got := p.dungeonClient(); got != "tw169" {
		t.Fatalf("live: %q", got)
	}
	p.readOnly.Store(true)
	if got := p.dungeonClient(); got != "" {
		t.Fatalf("replay: %q", got)
	}
}

func TestPickDetectPID(t *testing.T) {
	conns := []pcaputil.ClientConnection{{PID: 10}, {PID: 20}}
	if got := pickDetectPID(20, conns); got != 20 {
		t.Fatalf("followed PID alive: %d", got)
	}
	if got := pickDetectPID(99, conns); got != 10 {
		t.Fatalf("restarted client: %d", got)
	}
	if got := pickDetectPID(0, conns); got != 10 {
		t.Fatalf("no followed PID: %d", got)
	}
}

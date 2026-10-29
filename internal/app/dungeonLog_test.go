package app

import (
	"bufio"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
)

func TestDungeonLogFilenameOmitsTier(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	if err := d.Open("brileith", "NRD_3S", "地域磨菇", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Close()

	names, _ := filepath.Glob(filepath.Join(dir, "*.ndjson"))
	if len(names) != 1 {
		t.Fatalf("got %d files", len(names))
	}
	base := filepath.Base(names[0])
	if strings.Contains(base, "NRD_3S") {
		t.Fatalf("filename %q must not carry the tier", base)
	}
	if !strings.Contains(base, "地域磨菇") {
		t.Fatalf("filename %q lost the player segment", base)
	}
}

func TestDungeonLogMetaCarriesLocalTime(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	at := time.Date(2026, 8, 17, 9, 5, 3, 0, time.FixedZone("TW", 8*3600))
	var d dungeonLog
	if err := d.Open("brileith", "NRD_1S", "磨菇", at, 717000, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Close()

	names, _ := filepath.Glob(filepath.Join(dir, "*.ndjson"))
	f, _ := os.Open(names[0])
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Scan()
	var meta dungeonLogMeta
	if err := json.Unmarshal(sc.Bytes(), &meta); err != nil {
		t.Fatalf("meta: %v", err)
	}
	if want := "2026-08-17T09:05:03+08:00"; meta.StartedAtLocal != want {
		t.Fatalf("StartedAtLocal = %q, want %q", meta.StartedAtLocal, want)
	}
	// The offset must survive a round-trip, or the record is ambiguous.
	got, err := time.Parse(time.RFC3339, meta.StartedAtLocal)
	if err != nil || !got.Equal(at) {
		t.Fatalf("round-trip gave %v (err %v), want %v", got, err, at)
	}
}

func TestDungeonLogWritesMetaFirstLine(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	if err := d.Open("brileith", "NRD_1S", "地域磨菇", time.Unix(1786800000, 0), 717000, "packet_capture_20260820_160455.pcapng", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Close()

	names, _ := filepath.Glob(filepath.Join(dir, "*.ndjson"))
	f, _ := os.Open(names[0])
	defer f.Close()
	sc := bufio.NewScanner(f)
	if !sc.Scan() {
		t.Fatal("file is empty")
	}
	var meta dungeonLogMeta
	if err := json.Unmarshal(sc.Bytes(), &meta); err != nil {
		t.Fatalf("first line is not meta json: %v", err)
	}
	if meta.Kind != "meta" || meta.Tier != "NRD_1S" || meta.Player != "地域磨菇" {
		t.Fatalf("meta = %+v", meta)
	}
	if meta.Version == "" || meta.MissionId != 717000 {
		t.Fatalf("meta = %+v", meta)
	}
	if meta.Pcapng != "packet_capture_20260820_160455.pcapng" {
		t.Fatalf("meta.Pcapng = %q", meta.Pcapng)
	}
}

// A blank tier (most historical map-changes carry no dynamic-region base)
// must still produce a valid, non-collapsing filename and a readable meta.
// bytesIndexByte: first-line boundary for the meta parse below.
func bytesIndexByte(b []byte) int {
	for i, c := range b {
		if c == '\n' {
			return i
		}
	}
	return len(b)
}

func TestDungeonLogEmptyTierFallsBackToUnknown(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	if err := d.Open("brileith", "", "地域磨菇", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Close()

	// The fallback now lives in the meta line only, not the filename.
	names, _ := filepath.Glob(filepath.Join(dir, "*.ndjson"))
	if len(names) != 1 {
		t.Fatalf("got %d files", len(names))
	}

	f, _ := os.Open(names[0])
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Scan()
	var meta dungeonLogMeta
	if err := json.Unmarshal(sc.Bytes(), &meta); err != nil {
		t.Fatalf("meta: %v", err)
	}
	if meta.Tier != "unknown" {
		t.Fatalf("meta.Tier = %q, want %q", meta.Tier, "unknown")
	}
}

// Open must write the meta header before the seeded initial events, or the
// battle index (which trusts line 1) never sees the run and the seeded
// events (needed to resolve player names) are lost from the visible list.
func TestDungeonLogMetaPrecedesInitialEvents(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	initial := []event.IEvent{&event.EventOwnerCharacter{
		EventBase: event.EventBase{EventId: event.EventIdOwnerCharacter, At: 1786800000, Id: "1"},
		Name:      "地域磨菇",
	}}
	var d dungeonLog
	if err := d.Open("brileith", "NRD_1S", "地域磨菇", time.Unix(1786800000, 0), 717000, "", "", initial); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Close()

	names, _ := filepath.Glob(filepath.Join(dir, "*.ndjson"))
	f, _ := os.Open(names[0])
	defer f.Close()
	sc := bufio.NewScanner(f)

	if !sc.Scan() {
		t.Fatal("file is empty")
	}
	var meta dungeonLogMeta
	if err := json.Unmarshal(sc.Bytes(), &meta); err != nil || meta.Kind != "meta" {
		t.Fatalf("line 1 is not meta: err=%v meta=%+v", err, meta)
	}

	if !sc.Scan() {
		t.Fatal("line 2 (seeded event) is missing")
	}
	var line2 dungeonLogMeta
	if err := json.Unmarshal(sc.Bytes(), &line2); err != nil {
		t.Fatalf("line 2 is not valid json: %v", err)
	}
	if line2.Kind == "meta" {
		t.Fatalf("line 2 = %+v, should be the seeded event, not another meta line", line2)
	}
}

func mkAppear(id string, race uint32, name, owner string, at int64) *event.EventEntityAppear {
	return &event.EventEntityAppear{
		EventBase: event.EventBase{EventId: event.EventIdEntityAppear, At: at, Id: id},
		Name:      name, RaceId: race, OwnerId: owner,
	}
}

func mkDamage(attacker, target string, skill uint16, dmg float32, at int64) *event.EventDamage {
	return &event.EventDamage{
		EventBase: event.EventBase{EventId: event.EventIdDamage, At: at, Id: attacker},
		TargetId:  target, SkillId: skill, Damage: dmg,
	}
}

func mkCCEnable(id string, ccId uint32, params map[string]string, at int64, disableAt float64) *event.EventCharacterConditionEnable {
	return &event.EventCharacterConditionEnable{
		EventBase: event.EventBase{EventId: event.EventIdCharacterConditionEnable, At: at, Id: id},
		CCId:      ccId, DisableAt: disableAt, Params: params,
	}
}

func lastLine(t *testing.T, dir string) []byte {
	t.Helper()
	names, _ := filepath.Glob(filepath.Join(dir, "*.ndjson"))
	if len(names) != 1 {
		t.Fatalf("got %d files", len(names))
	}
	f, err := os.Open(names[0])
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var last []byte
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if len(strings.TrimSpace(sc.Text())) > 0 {
			last = append([]byte(nil), sc.Bytes()...)
		}
	}
	return last
}

// One run file covers the whole 1S->3S progression, so the summary lists
// one fight per stage: MRD_1S merges both phases (durations added, damage
// combined), 2S/3S stand alone. Pet/puppet damage rolls up to the owner.
func TestDungeonLogSummaryPerStageFights(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	if err := d.Open("brileith", "MRD_1S", "地域磨菇", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	p1, p2, b2, pcA, pcB, pet := "900", "901", "902", "100", "101", "102"
	d.Write([]event.IEvent{
		mkAppear(p1, 7600, "b1", "", 1000),
		mkAppear(p2, 7601, "b2", "", 1000),
		mkAppear(b2, 7602, "b3", "", 1000),
		mkAppear(pcA, 10001, "毛毛", "", 1000),
		mkAppear(pcB, 10002, "圓圓", "", 1000),
		mkAppear(pet, 990216, "puppet", pcA, 1000),
		// stage 1 phase 1: 40s span
		mkDamage(pcA, p1, 59166, 1000, 1000),
		mkDamage(pcB, p1, 59023, 1000, 1040),
		// stage 1 phase 2: 100s span (gap 1040->1100 not counted)
		mkDamage(pcA, p2, 59166, 4000, 1100),
		mkDamage(pet, p2, 59169, 2000, 1150),
		mkDamage(pcB, p2, 59023, 3000, 1200),
		&event.EventEntityDown{EventBase: event.EventBase{EventId: event.EventIdEntityDown, At: 1200, Id: p2}},
		// stage 2: 50s span, not downed
		mkDamage(pcA, b2, 59166, 7000, 1300),
		mkDamage(pcA, b2, 59166, 7000, 1350),
	})
	d.Close()

	var sum dungeonLogSummary
	if err := json.Unmarshal(lastLine(t, dir), &sum); err != nil {
		t.Fatalf("summary unmarshal: %v", err)
	}
	if sum.Kind != "summary" || sum.SummaryVersion != summaryVersion || len(sum.Fights) != 2 {
		t.Fatalf("summary shape wrong: %+v", sum)
	}

	f1, f2 := sum.Fights[0], sum.Fights[1]
	if f1.Stage != "MRD_1S" || f1.BossRace != 7601 || f1.BossName != "佩塔克" {
		t.Fatalf("fight1 boss wrong: %+v", f1)
	}
	// 40 + 100, phase gap excluded
	if f1.DurationSec != 140 || f1.FightStartAt != 1000 || f1.FightEndAt != 1200 {
		t.Fatalf("fight1 time wrong: %+v", f1)
	}
	if f1.Cleared == nil || !*f1.Cleared {
		t.Fatalf("fight1 must be cleared")
	}
	if f1.PartySize != 2 || len(f1.Players) != 2 {
		t.Fatalf("fight1 party wrong: %+v", f1)
	}
	byName := map[string]battlePlayer{}
	for _, p := range f1.Players {
		byName[p.Name] = p
	}
	a, b := byName["毛毛"], byName["圓圓"]
	if a.EntityId != pcA || a.Arcana != 9 || a.Damage != 7000 || a.Dps != 50 {
		t.Fatalf("player A wrong: %+v", a)
	}
	if b.Damage != 4000 {
		t.Fatalf("player B wrong: %+v", b)
	}
	// Players sorted by DPS desc for deterministic output.
	if f1.Players[0].Name != "毛毛" {
		t.Fatalf("players not DPS-sorted: %+v", f1.Players)
	}

	if f2.Stage != "MRD_2S" || f2.BossRace != 7602 || f2.DurationSec != 50 {
		t.Fatalf("fight2 wrong: %+v", f2)
	}
	if f2.Cleared == nil || *f2.Cleared {
		t.Fatalf("fight2 must be uncleared")
	}
}

// A wipe during phase 1 still yields an MRD_1S fight, resting on 7600 only.
func TestDungeonLogSummaryPhase1Wipe(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	if err := d.Open("brileith", "MRD_1S", "地域磨菇", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Write([]event.IEvent{
		mkAppear("900", 7600, "b1", "", 1000),
		mkAppear("100", 10001, "毛毛", "", 1000),
		mkDamage("100", "900", 59023, 500, 1000),
		mkDamage("100", "900", 59023, 500, 1050),
	})
	d.Close()

	var sum dungeonLogSummary
	if err := json.Unmarshal(lastLine(t, dir), &sum); err != nil {
		t.Fatalf("summary unmarshal: %v", err)
	}
	if len(sum.Fights) != 1 {
		t.Fatalf("want 1 fight, got %+v", sum)
	}
	f := sum.Fights[0]
	if f.BossRace != 7600 || f.DurationSec != 50 || f.Cleared == nil || *f.Cleared {
		t.Fatalf("phase-1 wipe fight wrong: %+v", f)
	}
}


// No boss damage at all: an empty summary marker is still written, so a
// later backfill pass knows the file was already analyzed.
func TestDungeonLogNoBossWritesEmptyMarker(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	if err := d.Open("brileith", "MRD_1S", "地域磨菇", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Write([]event.IEvent{mkAppear("100", 10001, "毛毛", "", 1000)})
	d.Close()

	var sum dungeonLogSummary
	if err := json.Unmarshal(lastLine(t, dir), &sum); err != nil {
		t.Fatal(err)
	}
	if sum.Kind != "summary" || len(sum.Fights) != 0 {
		t.Fatalf("want empty marker, got %+v", sum)
	}
}

// Cleared: true when the boss's down event was seen, false when the boss
// was fought but never downed.
func TestDungeonLogSummaryCleared(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	run := func(down bool) bossFight {
		var d dungeonLog
		if err := d.Open("brileith", "MRD_3S", "地域磨菇", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
			t.Fatalf("open: %v", err)
		}
		evs := []event.IEvent{
			mkAppear("900", 7603, "b", "", 1000),
			mkAppear("100", 10001, "毛毛", "", 1000),
			mkDamage("100", "900", 59023, 500, 1000),
			mkDamage("100", "900", 59023, 500, 1100),
		}
		if down {
			evs = append(evs, &event.EventEntityDown{
				EventBase: event.EventBase{EventId: event.EventIdEntityDown, At: 1100, Id: "900"},
			})
		}
		d.Write(evs)
		d.Close()
		var sum dungeonLogSummary
		if err := json.Unmarshal(lastLine(t, dir), &sum); err != nil {
			t.Fatal(err)
		}
		names, _ := filepath.Glob(filepath.Join(dir, "*.ndjson"))
		for _, n := range names {
			os.Remove(n)
		}
		if len(sum.Fights) != 1 {
			t.Fatalf("want 1 fight, got %+v", sum)
		}
		return sum.Fights[0]
	}

	if f := run(true); f.Cleared == nil || !*f.Cleared {
		t.Fatalf("downed run must be cleared, got %+v", f.Cleared)
	}
	if f := run(false); f.Cleared == nil || *f.Cleared {
		t.Fatalf("undowned run must be cleared=false, got %+v", f.Cleared)
	}
}

// New naming: dungeon_<code>_<tier>_<player>_yyyymmdd_hhmmss.ndjson.
func TestDungeonLogFilenameStampFormat(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	at := time.Date(2026, 8, 19, 21, 5, 7, 0, time.Local)
	if err := d.Open("brileith", "MRD_1S", "地域磨菇", at, 717000, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Close()
	names, _ := filepath.Glob(filepath.Join(dir, "*.ndjson"))
	if base := filepath.Base(names[0]); !strings.Contains(base, "20260819_210507") {
		t.Fatalf("filename %q lacks yyyymmdd_hhmmss stamp", base)
	}
}

// The training grounds (實戰課程-木頭人) summarize the last-fought dummy as
// the fight.
func TestDungeonLogSummaryTrainingDummy(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	if err := d.Open("training", "x", "地域磨菇", time.Unix(1786800000, 0), 730017, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Write([]event.IEvent{
		mkAppear("900", 4858, "dummy", "", 1000),
		mkAppear("100", 10001, "毛毛", "", 1000),
		mkDamage("100", "900", 59023, 500, 1000),
		mkDamage("100", "900", 59023, 500, 1060),
	})
	d.Close()

	var sum dungeonLogSummary
	if err := json.Unmarshal(lastLine(t, dir), &sum); err != nil {
		t.Fatal(err)
	}
	if len(sum.Fights) != 1 {
		t.Fatalf("want 1 fight, got %+v", sum)
	}
	f := sum.Fights[0]
	if f.BossRace != 4858 || f.BossName != "和魅魔女王一樣堅固的木頭人" || f.DurationSec != 60 {
		t.Fatalf("dummy fight wrong: %+v", f)
	}
	if f.Cleared != nil {
		t.Fatalf("a dummy fight must not carry a cleared verdict: %+v", f)
	}
}

// The boss-practice room (雷楠的米勒:悔恨) shares the training mission and
// gets its own fight row, cleared verdict included.
func TestDungeonLogSummaryRegretPractice(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	if err := d.Open("training", "x", "地域磨菇", time.Unix(1786800000, 0), 730017, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Write([]event.IEvent{
		mkAppear("900", 7615, "b", "", 1000),
		mkAppear("100", 10001, "毛毛", "", 1000),
		mkDamage("100", "900", 59023, 500, 1000),
		mkDamage("100", "900", 59023, 500, 1090),
		&event.EventEntityDown{EventBase: event.EventBase{EventId: event.EventIdEntityDown, At: 1090, Id: "900"}},
	})
	d.Close()

	var sum dungeonLogSummary
	if err := json.Unmarshal(lastLine(t, dir), &sum); err != nil {
		t.Fatal(err)
	}
	if len(sum.Fights) != 1 {
		t.Fatalf("want 1 fight, got %+v", sum)
	}
	f := sum.Fights[0]
	if f.BossRace != 7615 || f.BossName != "雷楠的米勒:悔恨" || f.DurationSec != 90 {
		t.Fatalf("regret fight wrong: %+v", f)
	}
	if f.Cleared == nil || !*f.Cleared {
		t.Fatalf("regret fight must carry a cleared verdict: %+v", f)
	}
}

// Music buffs (CC 680 戰場的序曲 / 192 活潑板) inside the fight window pick the
// highest pct seen, across either song; events outside the window are
// ignored, and an unparsable magnitude never wins.
func TestDungeonLogSummaryMusicBuffMaxPctWins(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	if err := d.Open("brileith", "MRD_3S", "地域磨菇", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Write([]event.IEvent{
		mkAppear("900", 7603, "b", "", 1000),
		mkAppear("100", 10001, "毛毛", "", 1000),
		// before the fight window, DisableAt unset (0): must be ignored even
		// though its pct is highest (falls back to the in-window rule)
		mkCCEnable("100", 680, map[string]string{"MCMBAMIN": "99"}, 500, 0),
		mkDamage("100", "900", 59023, 500, 1000),
		// inside the window: two different songs, the higher pct (680@8) wins
		mkCCEnable("100", 192, map[string]string{"LSMA": "5"}, 1020, 0),
		mkCCEnable("100", 680, map[string]string{"MCMBAMIN": "not-a-number"}, 1030, 0), // unparsable, ignored
		mkCCEnable("100", 680, map[string]string{"MCMBAMIN": "8"}, 1050, 0),
		mkDamage("100", "900", 59023, 500, 1100),
		// after the fight window: must be ignored
		mkCCEnable("100", 680, map[string]string{"MCMBAMIN": "50"}, 5000, 0),
	})
	d.Close()

	var sum dungeonLogSummary
	if err := json.Unmarshal(lastLine(t, dir), &sum); err != nil {
		t.Fatal(err)
	}
	if len(sum.Fights) != 1 || len(sum.Fights[0].Players) != 1 {
		t.Fatalf("want 1 fight with 1 player, got %+v", sum)
	}
	p := sum.Fights[0].Players[0]
	if p.MusicCcId != 680 || p.MusicPct != 8 {
		t.Fatalf("music wrong: %+v", p)
	}
}

// A pre-fight enable still counts when DisableAt overlaps the fight
// window (the real bug: CC680 enabled 198s before first damage, with
// DisableAt covering the whole fight, yet MusicPct stayed empty).
func TestDungeonLogSummaryMusicBuffPreWindowOverlapCounted(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	if err := d.Open("brileith", "MRD_3S", "地域磨菇", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Write([]event.IEvent{
		mkAppear("900", 7603, "b", "", 1000),
		mkAppear("100", 10001, "毛毛", "", 1000),
		// enabled well before the fight, but disables long after it ends
		mkCCEnable("100", 680, map[string]string{"MCMBAMIN": "20"}, 802, 1500),
		mkDamage("100", "900", 59023, 500, 1000),
		mkDamage("100", "900", 59023, 500, 1100),
	})
	d.Close()

	var sum dungeonLogSummary
	if err := json.Unmarshal(lastLine(t, dir), &sum); err != nil {
		t.Fatal(err)
	}
	p := sum.Fights[0].Players[0]
	if p.MusicCcId != 680 || p.MusicPct != 20 {
		t.Fatalf("pre-window buff overlapping the fight must count: %+v", p)
	}
}

// A pre-window enable whose DisableAt still ends before the fight starts
// never overlaps it, so it must not count.
func TestDungeonLogSummaryMusicBuffDisableEndsBeforeFightNotCounted(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	if err := d.Open("brileith", "MRD_3S", "地域磨菇", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Write([]event.IEvent{
		mkAppear("900", 7603, "b", "", 1000),
		mkAppear("100", 10001, "毛毛", "", 1000),
		// expired well before the fight starts: no overlap
		mkCCEnable("100", 680, map[string]string{"MCMBAMIN": "20"}, 500, 900),
		mkDamage("100", "900", 59023, 500, 1000),
		mkDamage("100", "900", 59023, 500, 1100),
	})
	d.Close()

	var sum dungeonLogSummary
	if err := json.Unmarshal(lastLine(t, dir), &sum); err != nil {
		t.Fatal(err)
	}
	p := sum.Fights[0].Players[0]
	if p.MusicCcId != 0 || p.MusicPct != 0 {
		t.Fatalf("expired-before-fight buff must not count: %+v", p)
	}
}

// DisableAt == 0 (unknown duration) falls back to the old in-window rule:
// an out-of-window observation is ignored even if its pct is highest.
func TestDungeonLogSummaryMusicBuffDisableAtZeroFallsBackToWindow(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	if err := d.Open("brileith", "MRD_3S", "地域磨菇", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Write([]event.IEvent{
		mkAppear("900", 7603, "b", "", 1000),
		mkAppear("100", 10001, "毛毛", "", 1000),
		// higher pct but before the window with no DisableAt: ignored
		mkCCEnable("100", 680, map[string]string{"MCMBAMIN": "99"}, 500, 0),
		// inside the window with no DisableAt: counted
		mkCCEnable("100", 680, map[string]string{"MCMBAMIN": "20"}, 1050, 0),
		mkDamage("100", "900", 59023, 500, 1000),
		mkDamage("100", "900", 59023, 500, 1100),
	})
	d.Close()

	var sum dungeonLogSummary
	if err := json.Unmarshal(lastLine(t, dir), &sum); err != nil {
		t.Fatal(err)
	}
	p := sum.Fights[0].Players[0]
	if p.MusicCcId != 680 || p.MusicPct != 20 {
		t.Fatalf("DisableAt=0 must fall back to the in-window rule: %+v", p)
	}
}

// A player with no recorded music events must omit MusicCcId/MusicPct from
// the JSON entirely (omitempty), not serialize zero values.
func TestDungeonLogSummaryMusicBuffOmittedWhenAbsent(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	if err := d.Open("brileith", "MRD_3S", "地域磨菇", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Write([]event.IEvent{
		mkAppear("900", 7603, "b", "", 1000),
		mkAppear("100", 10001, "毛毛", "", 1000),
		mkDamage("100", "900", 59023, 500, 1000),
		mkDamage("100", "900", 59023, 500, 1100),
	})
	d.Close()

	line := lastLine(t, dir)
	if strings.Contains(string(line), "MusicCcId") || strings.Contains(string(line), "MusicPct") {
		t.Fatalf("music fields must be omitted when absent: %s", line)
	}
}

// EventCaptureStatus is transient UI state (published ~every watchdog tick
// while packets flow), not battle data; it must never land in a run's file.
func TestDungeonLogSkipsCaptureStatus(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	if err := d.Open("brileith", "MRD_1S", "地域磨菇", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Write([]event.IEvent{
		mkAppear("100", 10001, "毛毛", "", 1000),
		&event.EventCaptureStatus{
			EventBase:    event.EventBase{EventId: event.EventIdCaptureStatus, At: 1000},
			NpcapOk:      true,
			GameDetected: true,
			Capturing:    true,
			LastPacketAt: 1000,
		},
	})
	d.Close()

	names, _ := filepath.Glob(filepath.Join(dir, "*.ndjson"))
	if len(names) != 1 {
		t.Fatalf("got %d files", len(names))
	}
	b, err := os.ReadFile(names[0])
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(b), "\"EventId\":22") {
		t.Fatalf("EventIdCaptureStatus must not be written to the dungeon log: %s", b)
	}
}

// 喀輪巴斯深淵 (mission 718000) and 布里萊赫練習模式 (717002) are recorded
// like the dungeons before them; the practice run reuses the MRD stages.
func TestDungeonCodesWhitelistAbyssAndPractice(t *testing.T) {
	if dungeonCodes[718000] != "crombas_abyss" {
		t.Fatalf("718000 -> %q, want crombas_abyss", dungeonCodes[718000])
	}
	if dungeonCodes[717002] != "brileith_practice" {
		t.Fatalf("717002 -> %q, want brileith_practice", dungeonCodes[717002])
	}
}

// 喀輪巴斯深淵: one fight against 佩洛姆 (193810). The abyss adds (幻影,
// 供給裝置, 結界) take damage too but are not stages and do not count.
func TestDungeonLogSummaryCromBasAbyss(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	if err := d.Open("crombas_abyss", "NTD_dungeon", "地域磨菇", time.Unix(1786800000, 0), 718000, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Write([]event.IEvent{
		mkAppear("900", 193810, "b", "", 1000),
		mkAppear("901", 193815, "d", "", 1000), // 黑暗爾格供給裝置
		mkAppear("100", 10001, "毛毛", "", 1000),
		mkDamage("100", "900", 59023, 500, 1000),
		mkDamage("100", "901", 59023, 100, 1050),
		mkDamage("100", "900", 59023, 500, 1120),
		&event.EventEntityDown{EventBase: event.EventBase{EventId: event.EventIdEntityDown, At: 1120, Id: "900"}},
	})
	d.Close()

	var sum dungeonLogSummary
	if err := json.Unmarshal(lastLine(t, dir), &sum); err != nil {
		t.Fatal(err)
	}
	if len(sum.Fights) != 1 {
		t.Fatalf("want 1 fight, got %+v", sum)
	}
	f := sum.Fights[0]
	if f.Stage != "佩洛姆" || f.BossRace != 193810 || f.BossName != "佩洛姆" || f.DurationSec != 120 {
		t.Fatalf("abyss fight wrong: %+v", f)
	}
	if f.Cleared == nil || !*f.Cleared {
		t.Fatalf("abyss fight must carry a cleared verdict: %+v", f)
	}
	if len(f.Players) != 1 || f.Players[0].Damage != 1000 {
		t.Fatalf("damage must count only the boss: %+v", f.Players)
	}
}

// Active DPS drops the opening 5s and the boss-invincible span (CC 494),
// while Dps keeps using the whole fight.
func TestDungeonLogSummaryActiveDps(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir

	var d dungeonLog
	if err := d.Open("brileith", "MRD_1S", "地域磨菇", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatalf("open: %v", err)
	}
	boss, pc := "900", "100"
	const T = 1000
	d.Write([]event.IEvent{
		mkAppear(boss, 7601, "b", "", T),
		mkAppear(pc, 10001, "毛毛", "", T),
		mkDamage(pc, boss, 59166, 0, T),
		mkDamage(pc, boss, 59166, 1000, T+2),
		mkCCEnable(boss, 494, nil, T+70, 0),
		&event.EventCharacterConditionDisable{
			EventBase: event.EventBase{EventId: event.EventIdCharacterConditionDisable, At: T + 90, Id: boss},
			CCId:      494,
		},
		mkDamage(pc, boss, 59166, 3000, T+50),
		mkDamage(pc, boss, 59166, 5000, T+80),
		mkDamage(pc, boss, 59166, 0, T+100),
	})
	d.Close()

	raw := lastLine(t, dir)
	if !strings.Contains(string(raw), `"SummaryVersion":8`) {
		t.Fatalf("summary version not 8: %s", raw)
	}
	var sum dungeonLogSummary
	if err := json.Unmarshal(raw, &sum); err != nil {
		t.Fatal(err)
	}
	p := sum.Fights[0].Players[0]
	if p.Dps != 90 {
		t.Fatalf("Dps = %v, want 90", p.Dps)
	}
	if p.ActiveDps == nil || *p.ActiveDps != 40 {
		t.Fatalf("ActiveDps = %v, want 40", p.ActiveDps)
	}
}

// Backfill replays recorded lines; the disable line must be decoded too,
// or every invincible span stays open until the fight ends.
func TestBackfillDecodesInvincibleDisable(t *testing.T) {
	lines := []string{
		`{"EventId":1,"At":1000,"Id":"900","Name":"b","RaceId":7601,"OwnerId":""}`,
		`{"EventId":1,"At":1000,"Id":"100","Name":"p","RaceId":10001,"OwnerId":""}`,
		`{"EventId":3,"At":1000,"Id":"100","TargetId":"900","SkillId":59166,"Damage":0}`,
		`{"EventId":3,"At":1050,"Id":"100","TargetId":"900","SkillId":59166,"Damage":3000}`,
		`{"EventId":4,"At":1070,"Id":"900","CCId":277,"DisableAt":9999,"Params":{}}`,
		`{"EventId":5,"At":1090,"Id":"900","CCId":277}`,
		`{"EventId":3,"At":1100,"Id":"100","TargetId":"900","SkillId":59166,"Damage":5000}`,
	}
	acc := newRunAccum("MRD_1S")
	for _, l := range lines {
		if e := decodeDungeonEvent([]byte(l)); e != nil {
			acc.observe(e)
		}
	}
	sum := acc.buildSummary()
	if sum == nil {
		t.Fatal("no summary")
	}
	p := sum.Fights[0].Players[0]
	// active time 100-5-20 = 75; damage 3000 + 5000
	if p.ActiveDps == nil || math.Abs(*p.ActiveDps-8000.0/75) > 0.01 {
		t.Fatalf("ActiveDps = %v", p.ActiveDps)
	}
}

// An older log's 0x7533 event (28) counts as condition 91000, unioned with
// 277 even though the boss takes damage under 277.
func TestBackfillDecodesInvincibleFlag(t *testing.T) {
	lines := []string{
		`{"EventId":1,"At":1000,"Id":"900","Name":"b","RaceId":7603,"OwnerId":""}`,
		`{"EventId":1,"At":1000,"Id":"100","Name":"p","RaceId":10001,"OwnerId":""}`,
		`{"EventId":3,"At":1000,"Id":"100","TargetId":"900","SkillId":59166,"Damage":0}`,
		`{"EventId":3,"At":1050,"Id":"100","TargetId":"900","SkillId":59166,"Damage":3000}`,
		`{"EventId":4,"At":1020,"Id":"900","CCId":277,"DisableAt":9999,"Params":{}}`,
		`{"EventId":5,"At":1060,"Id":"900","CCId":277}`,
		`{"EventId":28,"At":1070,"Id":"900","On":true}`,
		`{"EventId":28,"At":1090,"Id":"900","On":false}`,
		`{"EventId":3,"At":1100,"Id":"100","TargetId":"900","SkillId":59166,"Damage":5000}`,
	}
	acc := newRunAccum("MRD_3S")
	for _, l := range lines {
		if e := decodeDungeonEvent([]byte(l)); e != nil {
			acc.observe(e)
		}
	}
	sum := acc.buildSummary()
	if sum == nil {
		t.Fatal("no summary")
	}
	p := sum.Fights[0].Players[0]
	// active time 100-5-40-20 = 35; the 3000 hit lands under 277 and is left out
	if p.ActiveDps == nil || math.Abs(*p.ActiveDps-5000.0/35) > 0.01 {
		t.Fatalf("ActiveDps = %v", *p.ActiveDps)
	}
}

func TestSummaryCountsBossInvincibleCondition(t *testing.T) {
	lines := []string{
		`{"EventId":1,"At":1000,"Id":"900","Name":"b","RaceId":7603,"OwnerId":""}`,
		`{"EventId":1,"At":1000,"Id":"100","Name":"p","RaceId":10001,"OwnerId":""}`,
		`{"EventId":3,"At":1000,"Id":"100","TargetId":"900","SkillId":59166,"Damage":0}`,
		`{"EventId":4,"At":1070,"Id":"900","CCId":91000,"DisableAt":0,"Params":{}}`,
		`{"EventId":5,"At":1090,"Id":"900","CCId":91000}`,
		`{"EventId":3,"At":1100,"Id":"100","TargetId":"900","SkillId":59166,"Damage":7500}`,
	}
	acc := newRunAccum("MRD_3S")
	for _, l := range lines {
		if e := decodeDungeonEvent([]byte(l)); e != nil {
			acc.observe(e)
		}
	}
	p := acc.buildSummary().Fights[0].Players[0]
	// active time 100-5-20 = 75
	if p.ActiveDps == nil || math.Abs(*p.ActiveDps-7500.0/75) > 0.01 {
		t.Fatalf("ActiveDps = %v", *p.ActiveDps)
	}
}

// A player's own death span leaves their active time; a teammate who
// stayed alive keeps the full window.
func TestSummaryActiveDpsExcludesOwnDeath(t *testing.T) {
	lines := []string{
		`{"EventId":1,"At":1000,"Id":"900","Name":"b","RaceId":7601,"OwnerId":""}`,
		`{"EventId":1,"At":1000,"Id":"100","Name":"p","RaceId":10001,"OwnerId":""}`,
		`{"EventId":1,"At":1000,"Id":"101","Name":"q","RaceId":9001,"OwnerId":""}`,
		`{"EventId":3,"At":1000,"Id":"100","TargetId":"900","SkillId":59166,"Damage":0}`,
		`{"EventId":27,"At":1020,"Id":"100","Dead":true}`,
		`{"EventId":27,"At":1040,"Id":"100","Dead":false}`,
		`{"EventId":3,"At":1050,"Id":"100","TargetId":"900","SkillId":59166,"Damage":7500}`,
		`{"EventId":3,"At":1050,"Id":"101","TargetId":"900","SkillId":59166,"Damage":1900}`,
		`{"EventId":3,"At":1100,"Id":"100","TargetId":"900","SkillId":59166,"Damage":0}`,
	}
	acc := newRunAccum("MRD_1S")
	for _, l := range lines {
		if e := decodeDungeonEvent([]byte(l)); e != nil {
			acc.observe(e)
		}
	}
	sum := acc.buildSummary()
	if sum == nil {
		t.Fatal("no summary")
	}
	got := map[string]float64{}
	for _, p := range sum.Fights[0].Players {
		if p.ActiveDps == nil {
			t.Fatalf("player %s has no ActiveDps", p.EntityId)
		}
		got[p.EntityId] = *p.ActiveDps
	}
	// 100: 100-5-20 = 75 s; 101: 95 s
	if got["100"] != 100 || got["101"] != 20 {
		t.Fatalf("ActiveDps = %v", got)
	}
}

// DisableAt is fractional local seconds: it is compared against the fight
// window without truncation.
func TestDungeonLogSummaryMusicBuffFractionalDisableAt(t *testing.T) {
	run := func(disableAt float64) *battlePlayer {
		dir := t.TempDir()
		dungeonLogDirPath = dir

		var d dungeonLog
		if err := d.Open("brileith", "MRD_3S", "地域磨菇", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
			t.Fatalf("open: %v", err)
		}
		d.Write([]event.IEvent{
			mkAppear("900", 7603, "b", "", 1000),
			mkAppear("100", 10001, "毛毛", "", 1000),
			mkCCEnable("100", 680, map[string]string{"MCMBAMIN": "20"}, 802, disableAt),
			mkDamage("100", "900", 59023, 500, 1001),
			mkDamage("100", "900", 59023, 500, 1100),
		})
		d.Close()

		var sum dungeonLogSummary
		if err := json.Unmarshal(lastLine(t, dir), &sum); err != nil {
			t.Fatal(err)
		}
		if sum.SummaryVersion != 8 {
			t.Fatalf("SummaryVersion = %d, want 8", sum.SummaryVersion)
		}
		return &sum.Fights[0].Players[0]
	}
	if p := run(1001.4); p.MusicPct != 20 {
		t.Fatalf("buff ending at 1001.4 overlaps a window starting at 1001: %+v", p)
	}
	if p := run(1000.6); p.MusicPct != 0 {
		t.Fatalf("buff ending at 1000.6 is over before a window starting at 1001: %+v", p)
	}
}

func mkOwnerStats(at int64) *event.EventOwnerStats {
	return &event.EventOwnerStats{EventBase: event.EventBase{EventId: event.EventIdOwnerStats, At: at, Id: "1"}}
}

func mkOwnerEquip(at int64) *event.EventOwnerEquipment {
	return &event.EventOwnerEquipment{EventBase: event.EventBase{EventId: event.EventIdOwnerEquipment, At: at, Id: "1"}}
}

// recordedEvents returns [eventId, at] of every non-meta, non-summary line.
func recordedEvents(t *testing.T, dir string) [][2]int64 {
	t.Helper()
	names, _ := filepath.Glob(filepath.Join(dir, "*.ndjson"))
	if len(names) != 1 {
		t.Fatalf("got %d files", len(names))
	}
	f, err := os.Open(names[0])
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var out [][2]int64
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<24)
	for sc.Scan() {
		var l struct {
			Kind    string
			EventId int64
			At      int64
		}
		if json.Unmarshal(sc.Bytes(), &l) != nil || l.Kind != "" {
			continue
		}
		out = append(out, [2]int64{l.EventId, l.At})
	}
	return out
}

func TestDungeonLogThrottlesOwnerStats(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir
	var d dungeonLog
	if err := d.Open("brileith", "NRD_1S", "p", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatal(err)
	}
	for i := int64(0); i < 30; i++ {
		d.Write([]event.IEvent{mkOwnerStats(1000 + i)})
	}
	d.Close()
	got := recordedEvents(t, dir)
	if len(got) < 3 || len(got) > 4 {
		t.Fatalf("got %d stats lines, want 3-4: %v", len(got), got)
	}
	if got[len(got)-1][1] != 1029 {
		t.Fatalf("last stats At = %d, want 1029 (written by Close)", got[len(got)-1][1])
	}
	if lastLine(t, dir)[0] != '{' || !strings.Contains(string(lastLine(t, dir)), `"summary"`) {
		t.Fatalf("summary must stay last: %s", lastLine(t, dir))
	}
}

func TestDungeonLogThrottlesEquipmentIndependently(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir
	var d dungeonLog
	if err := d.Open("brileith", "NRD_1S", "p", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatal(err)
	}
	for i := int64(0); i < 30; i++ {
		d.Write([]event.IEvent{mkOwnerStats(1000 + i), mkOwnerEquip(1000 + i)})
	}
	d.Close()
	counts := map[int64]int{}
	for _, e := range recordedEvents(t, dir) {
		counts[e[0]]++
	}
	for _, id := range []event.EventId{event.EventIdOwnerStats, event.EventIdOwnerEquipment} {
		if c := counts[int64(id)]; c < 3 || c > 4 {
			t.Fatalf("event %d written %d times, want 3-4", id, c)
		}
	}
}

func TestDungeonLogThrottleLeavesOtherEvents(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir
	var d dungeonLog
	if err := d.Open("brileith", "NRD_1S", "p", time.Unix(1786800000, 0), 717000, "", "", nil); err != nil {
		t.Fatal(err)
	}
	for i := int64(0); i < 20; i++ {
		d.Write([]event.IEvent{mkDamage("1", "2", 1, 1, 1000+i), mkOwnerStats(1000 + i)})
	}
	d.Close()
	dmg := 0
	for _, e := range recordedEvents(t, dir) {
		if e[0] == int64(event.EventIdDamage) {
			dmg++
		}
	}
	if dmg != 20 {
		t.Fatalf("damage lines = %d, want 20", dmg)
	}
}

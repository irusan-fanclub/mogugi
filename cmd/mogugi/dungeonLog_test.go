package main

import (
	"bufio"
	"encoding/json"
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
	if err := d.Open("brileith", "NRD_3S", "地域磨菇", time.Unix(1786800000, 0), 717000, nil); err != nil {
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
	if err := d.Open("brileith", "NRD_1S", "磨菇", at, 717000, nil); err != nil {
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
	if err := d.Open("brileith", "NRD_1S", "地域磨菇", time.Unix(1786800000, 0), 717000, nil); err != nil {
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
	if err := d.Open("brileith", "", "地域磨菇", time.Unix(1786800000, 0), 717000, nil); err != nil {
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
	if err := d.Open("brileith", "NRD_1S", "地域磨菇", time.Unix(1786800000, 0), 717000, initial); err != nil {
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
	if err := d.Open("brileith", "MRD_1S", "地域磨菇", time.Unix(1786800000, 0), 717000, nil); err != nil {
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
	if sum.Kind != "summary" || sum.SummaryVersion != 2 || len(sum.Fights) != 2 {
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
	if err := d.Open("brileith", "MRD_1S", "地域磨菇", time.Unix(1786800000, 0), 717000, nil); err != nil {
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
	if err := d.Open("brileith", "MRD_1S", "地域磨菇", time.Unix(1786800000, 0), 717000, nil); err != nil {
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
		if err := d.Open("brileith", "MRD_3S", "地域磨菇", time.Unix(1786800000, 0), 717000, nil); err != nil {
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
	if err := d.Open("brileith", "MRD_1S", "地域磨菇", at, 717000, nil); err != nil {
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
	if err := d.Open("training", "x", "地域磨菇", time.Unix(1786800000, 0), 730017, nil); err != nil {
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
	if f.BossRace != 4858 || f.BossName != "木頭人" || f.DurationSec != 60 {
		t.Fatalf("dummy fight wrong: %+v", f)
	}
	if f.Cleared != nil {
		t.Fatalf("a dummy fight must not carry a cleared verdict: %+v", f)
	}
}

package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sort"
	"strings"
	"path/filepath"
	"sync"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/util"
)

// dungeonLogDirPath is the output dir for dungeon-event ndjson. A variable
// so tests can override it.
var dungeonLogDirPath = filepath.Join(_logDir, "dungeons")

// dungeonCodes: whitelisted dungeon missionId -> filename code. Currently
// only 布里萊赫 (Brileith); extend the whitelist as needed.
var dungeonCodes = map[uint32]string{
	717000: "brileith",
	730017: "training", // 實戰課程-木頭人
}

// dungeonLog, on entering a whitelisted dungeon, tees the event stream to
// dungeon_<code>_<tier>_<player>_<stamp>.ndjson and closes on exit.
// Has its own lock; never reaches back for eventPublisher's lock (lock order).
type dungeonLog struct {
	mu    sync.Mutex
	fd    *os.File
	accum *runAccum
}

// runAccum aggregates the run's events so Close can append a whole-run
// summary line without re-reading the file.
type runAccum struct {
	tier    string
	races   map[string]uint32
	names   map[string]string
	owners  map[string]string
	maxLife map[string]float64
	downed  map[string]bool
	// dmg[target][attacker] — attacker already resolved to its owner.
	dmg      map[string]map[string]float64
	firstHit map[string]int64
	lastHit  map[string]int64
	skills   map[string]map[uint16]bool
}

func newRunAccum(tier string) *runAccum {
	return &runAccum{
		tier:    tier,
		races:   map[string]uint32{},
		names:   map[string]string{},
		owners:  map[string]string{},
		maxLife: map[string]float64{},
		downed:  map[string]bool{},
		dmg:      map[string]map[string]float64{},
		firstHit: map[string]int64{},
		lastHit:  map[string]int64{},
		skills:   map[string]map[uint16]bool{},
	}
}

// rootOwner resolves a pet/puppet to its owner (one level is all the game
// produces); damage and arcana skills are credited there.
func (a *runAccum) rootOwner(id string) string {
	if o := a.owners[id]; o != "" {
		return o
	}
	return id
}

func (a *runAccum) observe(e event.IEvent) {
	switch v := e.(type) {
	case *event.EventEntityAppear:
		a.races[v.Id] = v.RaceId
		a.names[v.Id] = v.Name
		if v.OwnerId != "" {
			a.owners[v.Id] = v.OwnerId
		}
	case *event.EventMaxLife:
		a.maxLife[v.Id] = v.MaxLife
	case *event.EventEntityDown:
		a.downed[v.Id] = true
	case *event.EventDamage:
		who := a.rootOwner(v.Id)
		m := a.dmg[v.TargetId]
		if m == nil {
			m = map[string]float64{}
			a.dmg[v.TargetId] = m
		}
		m[who] += float64(v.Damage)
		if _, ok := a.firstHit[v.TargetId]; !ok {
			a.firstHit[v.TargetId] = v.At
		}
		a.lastHit[v.TargetId] = v.At
		sk := a.skills[who]
		if sk == nil {
			sk = map[uint16]bool{}
			a.skills[who] = sk
		}
		sk[v.SkillId] = true
	}
}

// stageDefs: one whole run traverses every stage in one file (1S/2S/3S are
// stages, not difficulties), so the summary reports one fight per stage.
// MRD_1S lists both phase races; the last race is the kill phase.
type stageDef struct {
	stage string
	races []uint32
}

var stageDefs = []stageDef{
	{"MRD_1S", []uint32{7600, 7601}},
	{"MRD_2S", []uint32{7602}},
	{"MRD_3S", []uint32{7603}},
	// Training dummies (實戰課程-木頭人): five stands, one fight row each,
	// so hitting several in one session stays分開統計.
	{"木頭人1", []uint32{4856}},
	{"木頭人2", []uint32{4857}},
	{"木頭人3", []uint32{4858}},
	{"木頭人4", []uint32{4859}},
	{"木頭人5", []uint32{4860}},
	// 實戰課程 boss-practice room (same mission as the dummies).
	{"悔恨", []uint32{7615}},
}

// battlePlayer is one party member in a fight summary.
type battlePlayer struct {
	EntityId string  `json:"EntityId"`
	Name     string  `json:"Name"`
	Arcana   int     `json:"Arcana"` // 0 = unknown
	Damage   int64   `json:"Damage"` // vs this fight's boss (all phases)
	Dps      float64 `json:"Dps"`
}

// bossFight is one stage's boss fight within a run.
type bossFight struct {
	Stage       string  `json:"Stage"`
	BossRace    uint32  `json:"BossRace"` // kill-phase race (7601 for MRD_1S)
	BossName    string  `json:"BossName"`
	BossMaxLife float64 `json:"BossMaxLife,omitempty"`
	// FightStartAt/EndAt are unix seconds; DurationSec sums the phases'
	// damage spans (the phase-transition gap is not fight time).
	FightStartAt int64 `json:"FightStartAt"`
	FightEndAt   int64 `json:"FightEndAt"`
	DurationSec  int64 `json:"DurationSec"`
	// Cleared: nil = unknown (old records lack the down event), otherwise
	// whether the kill-phase boss's life crossed zero.
	Cleared   *bool          `json:"Cleared,omitempty"`
	PartySize int            `json:"PartySize"`
	Players   []battlePlayer `json:"Players"`
}

// dungeonLogSummary is appended as the file's last line on Close. An empty
// Fights list is the "analyzed, no boss fought" marker.
type dungeonLogSummary struct {
	Kind           string      `json:"Kind"` // always "summary"
	SummaryVersion int         `json:"SummaryVersion"`
	Fights         []bossFight `json:"Fights,omitempty"`
}

const summaryVersion = 2

// buildSummary derives one fight per stage that saw boss damage; nil when
// no stage did.
func (a *runAccum) buildSummary() *dungeonLogSummary {
	var fights []bossFight
	for _, def := range stageDefs {
		if f := a.buildFight(def); f != nil {
			fights = append(fights, *f)
		}
	}
	if fights == nil {
		return nil
	}
	return &dungeonLogSummary{Kind: "summary", SummaryVersion: summaryVersion, Fights: fights}
}

func (a *runAccum) buildFight(def stageDef) *bossFight {
	// Latest-fought entity per phase race (failed attempts re-spawn the
	// same race under a new id; the last one is the fight that counts).
	var ents []string
	for _, race := range def.races {
		best := ""
		for id := range a.dmg {
			if a.races[id] != race {
				continue
			}
			if best == "" || a.lastHit[id] > a.lastHit[best] {
				best = id
			}
		}
		if best != "" {
			ents = append(ents, best)
		}
	}
	if ents == nil {
		return nil
	}
	primary := ents[len(ents)-1]

	var dur, start, end int64
	playerDmg := map[string]float64{}
	for i, id := range ents {
		dur += a.lastHit[id] - a.firstHit[id]
		if i == 0 || a.firstHit[id] < start {
			start = a.firstHit[id]
		}
		if a.lastHit[id] > end {
			end = a.lastHit[id]
		}
		for who, d := range a.dmg[id] {
			playerDmg[who] += d
		}
	}
	divisor := float64(dur)
	if divisor <= 0 {
		divisor = 1
	}

	cleared := a.downed[primary]
	// A training dummy never dies; "not cleared" would read as a wipe.
	var clearedPtr *bool
	if !strings.HasPrefix(def.stage, "木頭人") {
		clearedPtr = &cleared
	}
	f := &bossFight{
		Stage:        def.stage,
		BossRace:     a.races[primary],
		BossName:     bossRaces[a.races[primary]],
		BossMaxLife:  a.maxLife[primary],
		FightStartAt: start,
		FightEndAt:   end,
		DurationSec:  dur,
		Cleared:      clearedPtr,
	}
	for who, total := range playerDmg {
		if !playerRaceSet[a.races[who]] {
			continue
		}
		arcana := 0
		for sk := range a.skills[who] {
			if id := arcanaBySkill(sk); id != 0 {
				arcana = id
				break
			}
		}
		f.Players = append(f.Players, battlePlayer{
			EntityId: who,
			Name:     a.names[who],
			Arcana:   arcana,
			Damage:   int64(math.Round(total)),
			Dps:      math.Round(total/divisor*100) / 100,
		})
	}
	sort.Slice(f.Players, func(i, j int) bool { return f.Players[i].Dps > f.Players[j].Dps })
	f.PartySize = len(f.Players)
	return f
}

// dungeonLogMeta is the first line of every run file. It makes the file
// self-describing, and lets the battle index read one line per file.
type dungeonLogMeta struct {
	Kind    string `json:"Kind"` // always "meta"
	Version string `json:"Version"`
	Code    string `json:"Code"`
	// Tier is the entry stage's base region name (e.g. MRD_1S), not a
	// difficulty tier — a run always records whichever stage it entered at.
	Tier      string `json:"Tier"`
	Player    string `json:"Player"`
	MissionId uint32 `json:"MissionId"`
	// RFC3339 with the local offset: readable as local time, and still
	// unambiguous when the file is read on another machine.
	StartedAtLocal string `json:"StartedAtLocal"`
}

// Open creates a new file, writes the meta header, then initial (EntityAppear/
// condition/equip events from the entityCache snapshot) — teammates usually
// appeared before dungeon entry, so without seeding the file has only damage
// events that can't be matched back to player names. Closes any open file
// first. tier is the dynamic region's base name; empty becomes "unknown" so
// the filename never collapses to fewer segments.
func (d *dungeonLog) Open(code, tier, owner string, at time.Time, missionId uint32, initial []event.IEvent) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.closeLocked()

	if tier == "" {
		tier = "unknown"
	}

	if err := os.MkdirAll(dungeonLogDirPath, 0o755); err != nil {
		return err
	}
	// Tier is meta-only: it names the entry stage, not the run, and made
	// filenames read like difficulty labels.
	base := fmt.Sprintf("dungeon_%s_%s_%s", code,
		sanitizeEntityName(owner), util.FileStamp(at))
	var fd *os.File
	var err error
	for i := 0; ; i++ {
		name := base + ".ndjson"
		if i > 0 {
			name = fmt.Sprintf("%s_%d.ndjson", base, i+1)
		}
		fd, err = os.OpenFile(filepath.Join(dungeonLogDirPath, name), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			logger.Printf("dungeon-log: open %s (%d seeded events)", name, len(initial))
			break
		}
		if !os.IsExist(err) {
			return err
		}
	}
	d.fd = fd
	d.accum = newRunAccum(tier)
	setOpenDungeonFile(filepath.Base(fd.Name()))
	meta := dungeonLogMeta{
		Kind:           "meta",
		Version:        Version,
		Code:           code,
		Tier:           tier,
		Player:         owner,
		MissionId:      missionId,
		StartedAtLocal: at.Format(time.RFC3339),
	}
	// A file without its meta line is invisible to the battle index and
	// looks corrupt to anything that trusts the header, so a failed header
	// abandons the file rather than half-writing it.
	b, err := json.Marshal(meta)
	if err != nil {
		d.closeLocked()
		return err
	}
	if _, err := d.fd.Write(append(b, '\n')); err != nil {
		d.closeLocked()
		return err
	}
	d.writeLocked(initial)
	return nil
}

// Write appends a batch of events; no-op when no file is open. Like the main
// packet_log, skips negative (system-layer) events.
func (d *dungeonLog) Write(events []event.IEvent) {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.writeLocked(events)
}

func (d *dungeonLog) writeLocked(events []event.IEvent) {
	if d.fd == nil {
		return
	}
	for _, e := range events {
		if e.GetEventId() < 0 {
			continue
		}
		if d.accum != nil {
			d.accum.observe(e)
		}
		b, err := json.Marshal(e)
		if err != nil {
			continue
		}
		b = append(b, '\n')
		if _, err := d.fd.Write(b); err != nil {
			logger.Println("dungeon-log write failed:", err)
			d.closeLocked()
			return
		}
	}
}

// IsOpen reports whether a log file is currently open.
func (d *dungeonLog) IsOpen() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.fd != nil
}

// Close closes the current file if any. Safe to call repeatedly.
func (d *dungeonLog) Close() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.closeLocked()
}

func (d *dungeonLog) closeLocked() {
	if d.fd == nil {
		return
	}
	// Whole-run summary as the last line; a run that never touched a boss
	// (or an abandoned header) closes without one.
	if d.accum != nil {
		sum := d.accum.buildSummary()
		if sum == nil {
			// Empty marker: tells the backfill pass this file is already
			// analyzed and simply had no boss fight.
			sum = &dungeonLogSummary{Kind: "summary", SummaryVersion: summaryVersion}
		}
		if b, err := json.Marshal(sum); err == nil {
			_, _ = d.fd.Write(append(b, '\n'))
		}
		d.accum = nil
	}
	setOpenDungeonFile("")
	logger.Printf("dungeon-log: close %s", filepath.Base(d.fd.Name()))
	_ = d.fd.Sync()
	_ = d.fd.Close()
	d.fd = nil
}

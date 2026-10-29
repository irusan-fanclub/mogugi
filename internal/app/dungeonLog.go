package app

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/util"
)

// dungeonLogDirPath is the output dir for dungeon-event ndjson. A variable
// so tests can override it.
var dungeonLogDirPath = DataPath("logs", "dungeons")

// dungeonCodes: whitelisted dungeon missionId -> filename code (the code
// is also the battle-records dungeon key, see front DUNGEON_NAMES).
var dungeonCodes = map[uint32]string{
	717000: "brileith",
	717002: "brileith_practice", // 布里萊赫練習模式: same MRD stages and bosses
	718000: "crombas_abyss",     // 喀輪巴斯深淵
	730017: "training",          // 實戰課程-木頭人
}

// dungeonLog, on entering a whitelisted dungeon, tees the event stream to
// dungeon_<code>_<tier>_<player>_<stamp>.ndjson and closes on exit.
// Has its own lock; never reaches back for eventPublisher's lock (lock order).
type dungeonLog struct {
	mu    sync.Mutex
	fd    *os.File
	accum *runAccum
	// thr throttles the high-rate owner snapshots, one window per kind.
	thr map[event.EventId]*throttleSlot
	wg  sync.WaitGroup
}

// ownerThrottleSec is the minimum event-time gap between two recorded
// OwnerStats (or OwnerEquipment) events.
const ownerThrottleSec = 10

// throttleSlot holds a kind's last written time and the latest suppressed
// event, which Close still writes.
type throttleSlot struct {
	lastAt  int64
	written bool
	pending event.IEvent
}

// musicHeadlineKey: per-song CCId -> its headline-magnitude Params key,
// matching front/src/lib/musicBuff.ts. The two songs are mutually exclusive.
var musicHeadlineKey = map[uint32]string{680: "MCMBAMIN", 192: "LSMA"}

// musicObs is one recorded music-buff (CC 680/192) enable for an entity.
// DisableAt is 0 when the enable event carried no known expiry.
type musicObs struct {
	At        int64
	DisableAt float64
	CCId      uint32
	Pct       float64
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
	// music[entityId] — every parsed music-buff enable seen for that entity.
	music map[string][]musicObs
	// cc[entityId] — invincible-CC toggles; hits[target] — every hit on it.
	cc   map[string][]ccToggle
	hits map[string][]hitRec
	// deaths[playerId] — death/revive toggles.
	deaths map[string][]deathToggle
}

func newRunAccum(tier string) *runAccum {
	return &runAccum{
		tier:     tier,
		races:    map[string]uint32{},
		names:    map[string]string{},
		owners:   map[string]string{},
		maxLife:  map[string]float64{},
		downed:   map[string]bool{},
		dmg:      map[string]map[string]float64{},
		firstHit: map[string]int64{},
		lastHit:  map[string]int64{},
		skills:   map[string]map[uint16]bool{},
		music:    map[string][]musicObs{},
		cc:       map[string][]ccToggle{},
		hits:     map[string][]hitRec{},
		deaths:   map[string][]deathToggle{},
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
	case *event.EventEntityDeath:
		a.deaths[v.Id] = append(a.deaths[v.Id], deathToggle{At: v.At, Dead: v.Dead})
	case *event.EventEntityInvincible:
		a.cc[v.Id] = append(a.cc[v.Id], ccToggle{At: v.At, CCId: bossInvincibleCCId, On: v.On})
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
		a.hits[v.TargetId] = append(a.hits[v.TargetId], hitRec{At: v.At, Who: who, Damage: float64(v.Damage)})
		sk := a.skills[who]
		if sk == nil {
			sk = map[uint16]bool{}
			a.skills[who] = sk
		}
		sk[v.SkillId] = true
	case *event.EventCharacterConditionDisable:
		if invincibleCCs[v.CCId] {
			a.cc[v.Id] = append(a.cc[v.Id], ccToggle{At: v.At, CCId: v.CCId})
		}
	case *event.EventCharacterConditionEnable:
		if invincibleCCs[v.CCId] {
			a.cc[v.Id] = append(a.cc[v.Id], ccToggle{At: v.At, CCId: v.CCId, On: true})
		}
		key, ok := musicHeadlineKey[v.CCId]
		if !ok {
			return
		}
		pct, err := strconv.ParseFloat(v.Params[key], 64)
		if err != nil {
			return
		}
		a.music[v.Id] = append(a.music[v.Id], musicObs{At: v.At, DisableAt: v.DisableAt, CCId: v.CCId, Pct: pct})
	}
}

// bestMusic returns the highest music-buff pct (and its CCId) recorded for
// id whose interval overlaps [start, end]; zero value if none. DisableAt
// unset (0) falls back to requiring At itself inside the window.
func (a *runAccum) bestMusic(id string, start, end int64) (uint32, float64) {
	var ccId uint32
	var pct float64
	for _, m := range a.music[id] {
		var overlaps bool
		if m.DisableAt != 0 {
			overlaps = m.At <= end && m.DisableAt >= float64(start)
		} else {
			overlaps = m.At >= start && m.At <= end
		}
		if !overlaps || m.Pct <= pct {
			continue
		}
		ccId, pct = m.CCId, m.Pct
	}
	return ccId, pct
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
	// 雷楠的米勒:悔恨 — appears inside the brileith mission (717000)
	// on the MRD_3S base, so the existing whitelist already records it.
	{"悔恨", []uint32{7615}},
	// 喀輪巴斯深淵 (718000): the adds (幻影 193811-193813, 供給裝置 193815,
	// 結界 193814) are not stages; only the boss counts.
	{"佩洛姆", []uint32{193810}},
}

// battlePlayer is one party member in a fight summary.
type battlePlayer struct {
	EntityId string  `json:"EntityId"`
	Name     string  `json:"Name"`
	Arcana   int     `json:"Arcana"` // 0 = unknown
	Damage   int64   `json:"Damage"` // vs this fight's boss (all phases)
	Dps      float64 `json:"Dps"`
	// MusicCcId/MusicPct: highest music-buff (CC 680/192) pct seen for this
	// player during the fight window; both zero (omitted) if none.
	MusicCcId uint32  `json:"MusicCcId,omitempty"`
	MusicPct  float64 `json:"MusicPct,omitempty"`
	// ActiveDps skips the opening and boss-invincible time; nil if none left.
	ActiveDps *float64 `json:"ActiveDps,omitempty"`
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

// v8: the 0x7533 flag is condition 91000, unioned with 494/277 instead of
// replacing them.
// v7: ActiveDps also skips the 0x7533 boss-invincible flag.
// v6: marks the new float, local-clock DisableAt format in new logs; old
// event lines keep their uncorrected whole-second values.
// v5: per-player ActiveDps
// v4: bestMusic now counts an observation whose DisableAt overlaps the
// fight window, not just enables that landed inside it — a buff enabled
// well before the fight but still active throughout was being missed.
const summaryVersion = 8

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

	var windows []span
	var toggles []ccToggle
	for _, id := range ents {
		windows = append(windows, span{a.firstHit[id], a.lastHit[id]})
		toggles = append(toggles, a.cc[id]...)
	}
	invincible := invincibleWindows(toggles, end)

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
		musicCcId, musicPct := a.bestMusic(who, start, end)
		var mine []hitRec
		for _, id := range ents {
			for _, h := range a.hits[id] {
				if h.Who == who {
					mine = append(mine, h)
				}
			}
		}
		var activePtr *float64
		excluded := excludedSpans(start, slices.Concat(invincible, deathSpans(a.deaths[who], end)))
		if v, ok := activeDps(mine, windows, excluded); ok {
			v = math.Round(v*100) / 100
			activePtr = &v
		}
		f.Players = append(f.Players, battlePlayer{
			EntityId:  who,
			Name:      a.names[who],
			Arcana:    arcana,
			Damage:    int64(math.Round(total)),
			Dps:       math.Round(total/divisor*100) / 100,
			MusicCcId: musicCcId,
			MusicPct:  musicPct,
			ActiveDps: activePtr,
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
	// Pcapng is the raw capture this run came from (basename): the file
	// being written live, or the replayed input. Empty with --no-pcap.
	Pcapng string `json:"Pcapng,omitempty"`
	// Client is the game client build (e.g. tw169); Version is the app's.
	Client string `json:"Client,omitempty"`
}

// Open creates a new file, writes the meta header, then initial (EntityAppear/
// condition/equip events from the entityCache snapshot) — teammates usually
// appeared before dungeon entry, so without seeding the file has only damage
// events that can't be matched back to player names. Closes any open file
// first. tier is the dynamic region's base name; empty becomes "unknown" so
// the filename never collapses to fewer segments.
func (d *dungeonLog) Open(code, tier, owner string, at time.Time, missionId uint32, pcapng, client string, initial []event.IEvent) error {
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
		// A compressed twin means the name is taken even though the plain
		// file is gone.
		if _, serr := os.Stat(filepath.Join(dungeonLogDirPath, name+".gz")); serr == nil {
			continue
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
	d.thr = map[event.EventId]*throttleSlot{}
	setOpenDungeonFile(filepath.Base(fd.Name()))
	meta := dungeonLogMeta{
		Kind:           "meta",
		Version:        Version,
		Code:           code,
		Tier:           tier,
		Player:         owner,
		MissionId:      missionId,
		StartedAtLocal: at.Format(time.RFC3339),
		Pcapng:         pcapng,
		Client:         client,
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
		// CaptureStatus is transient UI state, not battle data; skip it
		// like negative (system-layer) events.
		if e.GetEventId() < 0 || e.GetEventId() == event.EventIdCaptureStatus {
			continue
		}
		if d.accum != nil {
			d.accum.observe(e)
		}
		if !d.flushDueLocked(e) {
			return
		}
		if id := e.GetEventId(); id == event.EventIdOwnerStats || id == event.EventIdOwnerEquipment {
			slot := d.thr[id]
			if slot == nil {
				slot = &throttleSlot{}
				d.thr[id] = slot
			}
			if slot.written && eventAt(e)-slot.lastAt < ownerThrottleSec {
				slot.pending = e
				continue
			}
			slot.written, slot.lastAt, slot.pending = true, eventAt(e), nil
		}
		if !d.writeEventLocked(e) {
			return
		}
	}
}

// flushDueLocked writes, ahead of a non-throttled event e, every suppressed
// value whose window has opened by e's time, so a quiet owner stream does
// not hold a value back until Close. False means a write failed.
func (d *dungeonLog) flushDueLocked(e event.IEvent) bool {
	now, self := eventAt(e), e.GetEventId()
	if self == event.EventIdOwnerStats || self == event.EventIdOwnerEquipment {
		return true // their own window handles them
	}
	var due []event.EventId
	for id, slot := range d.thr {
		if slot.pending != nil && now-slot.lastAt >= ownerThrottleSec {
			due = append(due, id)
		}
	}
	sort.Slice(due, func(i, j int) bool {
		return eventAt(d.thr[due[i]].pending) < eventAt(d.thr[due[j]].pending)
	})
	for _, id := range due {
		slot := d.thr[id]
		p := slot.pending
		slot.pending, slot.lastAt = nil, eventAt(p)
		if !d.writeEventLocked(p) {
			return false
		}
	}
	return true
}

// eventAt is the event's unix-second timestamp, 0 when it has none.
func eventAt(e event.IEvent) int64 {
	if a, ok := e.(interface{ GetAt() int64 }); ok {
		return a.GetAt()
	}
	return 0
}

// writeEventLocked appends one event line; false means the write failed and
// the file was closed.
func (d *dungeonLog) writeEventLocked(e event.IEvent) bool {
	b, err := json.Marshal(e)
	if err != nil {
		return true
	}
	if _, err := d.fd.Write(append(b, '\n')); err != nil {
		logger.Println("dungeon-log write failed:", err)
		d.closeLocked()
		return false
	}
	return true
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
	// Suppressed owner snapshots: the latest of each kind goes in before
	// the summary, in event order.
	var pend []event.IEvent
	for _, slot := range d.thr {
		if slot.pending != nil {
			pend = append(pend, slot.pending)
		}
	}
	sort.SliceStable(pend, func(i, j int) bool { return eventAt(pend[i]) < eventAt(pend[j]) })
	d.thr = nil
	for _, e := range pend {
		if !d.writeEventLocked(e) {
			return
		}
	}
	sumOK := false // only a record with its summary line is compressed
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
			_, werr := d.fd.Write(append(b, '\n'))
			sumOK = werr == nil
		}
		d.accum = nil
	}
	setOpenDungeonFile("")
	logger.Printf("dungeon-log: close %s", filepath.Base(d.fd.Name()))
	_ = d.fd.Sync()
	_ = d.fd.Close()
	name := d.fd.Name()
	d.fd = nil
	if dungeonGzipEnabled && sumOK {
		// Off the lock and the publisher's path: a 40 MB record takes
		// most of a second to gzip.
		d.wg.Add(1)
		go func() {
			defer d.wg.Done()
			if _, err := compressBattleFile(name); err != nil {
				logger.Println("dungeon-log: gzip failed:", err)
			}
		}()
	}
}

// waitCompress blocks until every background gzip has finished. Shutdown
// does not call it: an interrupted gzip leaves the plain record intact and
// the next startup sweep removes the temp file and compresses it again.
func (d *dungeonLog) waitCompress() { d.wg.Wait() }

// dungeonGzipEnabled gates gzip-on-close; tests that read the plain file
// right after Close turn it off.
var dungeonGzipEnabled = true

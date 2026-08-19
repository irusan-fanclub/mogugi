package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
)

// BattleFight is one stage's boss fight, projected for the index API.
// OwnerDps/OwnerArcana are the recording player's own numbers in that fight.
type BattleFight struct {
	Stage        string         `json:"stage"`
	BossRace     uint32         `json:"bossRace"`
	BossName     string         `json:"bossName"`
	BossMaxLife  float64        `json:"bossMaxLife,omitempty"`
	FightStartAt int64          `json:"fightStartAt"`
	FightEndAt   int64          `json:"fightEndAt"`
	DurationSec  int64          `json:"durationSec"`
	Cleared      *bool          `json:"cleared,omitempty"`
	PartySize    int            `json:"partySize"`
	OwnerDps     float64        `json:"ownerDps,omitempty"`
	OwnerArcana  int            `json:"ownerArcana,omitempty"`
	Players      []battlePlayer `json:"players"`
}

// BattleRecord summarizes one recorded dungeon run for the battle index.
// Fights is empty for files without a summary tail (still recording).
type BattleRecord struct {
	File           string `json:"file"`
	Code           string `json:"code"`
	Tier           string `json:"tier"`
	Player         string `json:"player"`
	StartedAtLocal string `json:"startedAtLocal"`
	SizeBytes      int64  `json:"sizeBytes"`

	Note   string        `json:"note,omitempty"`
	Fights []BattleFight `json:"fights,omitempty"`
}

// scanBattleRecords reads only the first line of every file in dir, skipping
// files without a valid "meta" header (old runs predate the header format).
// A missing dir is an empty index, not an error, for first-run users.
func scanBattleRecords(dir string) ([]BattleRecord, error) {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return []BattleRecord{}, nil
	}
	if err != nil {
		return nil, err
	}

	notes := loadBattleNotes()
	records := []BattleRecord{}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		rec, ok := readBattleRecord(dir, entry)
		if !ok {
			continue
		}
		rec.Note = notes[rec.File]
		records = append(records, rec)
	}

	// RFC3339's lexical order matches chronological order within one zone
	// (see dungeonLogMeta.StartedAtLocal); cross-zone records are rare
	// enough that string comparison is good enough here. Stable with a File
	// tie-break so same-second runs order deterministically across scans.
	sort.SliceStable(records, func(i, j int) bool {
		if records[i].StartedAtLocal != records[j].StartedAtLocal {
			return records[i].StartedAtLocal > records[j].StartedAtLocal
		}
		return records[i].File < records[j].File
	})
	return records, nil
}

// readBattleRecord parses one file's first line as dungeonLogMeta. ok is
// false for unreadable files, non-meta first lines, or bad JSON.
func readBattleRecord(dir string, entry os.DirEntry) (BattleRecord, bool) {
	path := filepath.Join(dir, entry.Name())
	f, err := os.Open(path)
	if err != nil {
		return BattleRecord{}, false
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	if !sc.Scan() {
		return BattleRecord{}, false
	}
	var meta dungeonLogMeta
	if err := json.Unmarshal(sc.Bytes(), &meta); err != nil || meta.Kind != "meta" {
		return BattleRecord{}, false
	}

	info, err := entry.Info()
	if err != nil {
		return BattleRecord{}, false
	}

	rec := BattleRecord{
		File:           entry.Name(),
		Code:           meta.Code,
		Tier:           meta.Tier,
		Player:         meta.Player,
		StartedAtLocal: meta.StartedAtLocal,
		SizeBytes:      info.Size(),
	}

	if sum, _, ok := readSummaryTail(f, info.Size()); ok {
		for _, ft := range sum.Fights {
			bf := BattleFight{
				Stage:        ft.Stage,
				BossRace:     ft.BossRace,
				BossName:     ft.BossName,
				BossMaxLife:  ft.BossMaxLife,
				FightStartAt: ft.FightStartAt,
				FightEndAt:   ft.FightEndAt,
				DurationSec:  ft.DurationSec,
				Cleared:      ft.Cleared,
				PartySize:    ft.PartySize,
				Players:      ft.Players,
			}
			for _, p := range ft.Players {
				if p.Name == meta.Player {
					bf.OwnerDps = p.Dps
					bf.OwnerArcana = p.Arcana
					break
				}
			}
			rec.Fights = append(rec.Fights, bf)
		}
	}
	return rec, true
}

// summaryTailWindow bounds the tail read; a summary line is a few KB even
// with a full party.
const summaryTailWindow = 64 * 1024

// readSummaryTail parses the file's last non-empty line as a summary,
// also returning the line's byte offset (so an outdated summary can be
// truncated and rewritten). ok is false when the tail is anything else.
func readSummaryTail(f *os.File, size int64) (dungeonLogSummary, int64, bool) {
	off := size - summaryTailWindow
	if off < 0 {
		off = 0
	}
	buf := make([]byte, size-off)
	if _, err := f.ReadAt(buf, off); err != nil {
		return dungeonLogSummary{}, 0, false
	}
	trimmed := bytes.TrimRight(buf, "\n\r ")
	idx := bytes.LastIndexByte(trimmed, '\n')
	last := bytes.TrimSpace(trimmed[idx+1:])
	var sum dungeonLogSummary
	if err := json.Unmarshal(last, &sum); err != nil || sum.Kind != "summary" {
		return dungeonLogSummary{}, 0, false
	}
	return sum, off + int64(idx) + 1, true
}

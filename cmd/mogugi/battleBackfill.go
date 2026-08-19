package main

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sync"

	"github.com/irusan-fanclub/mogugi/lib/event"
)

// openDungeonFileName is the basename of the run file currently being
// written (empty when none) — the backfill pass must never touch it.
var (
	openDungeonFileMu   sync.Mutex
	openDungeonFileName string
)

func setOpenDungeonFile(name string) {
	openDungeonFileMu.Lock()
	openDungeonFileName = name
	openDungeonFileMu.Unlock()
}

func getOpenDungeonFile() string {
	openDungeonFileMu.Lock()
	defer openDungeonFileMu.Unlock()
	return openDungeonFileName
}

// decodeDungeonEvent revives one recorded line into the event types the
// summary accumulator understands; nil for everything else.
func decodeDungeonEvent(line []byte) event.IEvent {
	var probe struct{ EventId event.EventId }
	if json.Unmarshal(line, &probe) != nil {
		return nil
	}
	var v event.IEvent
	switch probe.EventId {
	case event.EventIdEntityAppear:
		v = &event.EventEntityAppear{}
	case event.EventIdDamage:
		v = &event.EventDamage{}
	case event.EventIdMaxLife:
		v = &event.EventMaxLife{}
	case event.EventIdEntityDown:
		v = &event.EventEntityDown{}
	default:
		return nil
	}
	if json.Unmarshal(line, v) != nil {
		return nil
	}
	return v
}

// backfillSummaries appends a summary line to every closed run file that
// lacks one, by replaying its events. Cleared is forced to unknown — these
// files predate the boss-down event, so its absence proves nothing.
// Idempotent: files whose tail already parses as a summary are skipped.
func backfillSummaries(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	skip := getOpenDungeonFile()
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".ndjson" || entry.Name() == skip {
			continue
		}
		backfillOne(filepath.Join(dir, entry.Name()))
	}
}

func backfillOne(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return
	}
	oldSum, sumOff, hasSum := readSummaryTail(f, info.Size())
	if hasSum && oldSum.SummaryVersion >= summaryVersion {
		f.Close()
		return
	}
	if _, err := f.Seek(0, 0); err != nil {
		f.Close()
		return
	}

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1024*1024), 1024*1024)
	if !sc.Scan() {
		f.Close()
		return
	}
	var meta dungeonLogMeta
	if json.Unmarshal(sc.Bytes(), &meta) != nil || meta.Kind != "meta" {
		f.Close()
		return
	}
	accum := newRunAccum(meta.Tier)
	for sc.Scan() {
		if e := decodeDungeonEvent(sc.Bytes()); e != nil {
			accum.observe(e)
		}
	}
	f.Close()
	if sc.Err() != nil {
		return
	}

	sum := accum.buildSummary()
	if sum == nil {
		sum = &dungeonLogSummary{Kind: "summary", SummaryVersion: summaryVersion}
	}
	// Old files predate the boss-down event: without a single down line,
	// "not downed" proves nothing, so Cleared stays unknown.
	if len(accum.downed) == 0 {
		for i := range sum.Fights {
			sum.Fights[i].Cleared = nil
		}
	}
	b, err := json.Marshal(sum)
	if err != nil {
		return
	}
	// An outdated summary line is replaced, not stacked.
	if hasSum {
		if err := os.Truncate(path, sumOff); err != nil {
			return
		}
	}
	out, err := os.OpenFile(path, os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return
	}
	defer out.Close()
	logger.Printf("battle-index: backfilled summary for %s", filepath.Base(path))
	_, _ = out.Write(append(b, '\n'))
}

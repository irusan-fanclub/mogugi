package app

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
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
	case event.EventIdEntityDeath:
		v = &event.EventEntityDeath{}
	case event.EventIdEntityInvincible:
		v = &event.EventEntityInvincible{}
	case event.EventIdCharacterConditionEnable:
		v = &event.EventCharacterConditionEnable{}
	case event.EventIdCharacterConditionDisable:
		v = &event.EventCharacterConditionDisable{}
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
		if entry.IsDir() || !isBattleFileName(entry.Name()) || entry.Name() == skip {
			continue
		}
		if hasGzSibling(dir, entry.Name()) {
			continue
		}
		backfillOne(filepath.Join(dir, entry.Name()))
	}
}

// recordFileMu serialises backfill (rewrites the tail) against compression
// (replaces the file) and the sweep's file removals. Never call backfillOne
// from inside compressBattleFile: the mutex is not reentrant.
var recordFileMu sync.Mutex

func backfillOne(path string) {
	if backfillCurrent(path) { // lock-free fast path: nothing to do
		return
	}
	recordFileMu.Lock()
	defer recordFileMu.Unlock()
	if filepath.Base(path) == getOpenDungeonFile() {
		return
	}
	if isGzBattleFile(path) {
		upgradeGzRecord(path)
		return
	}
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

// finishSummary turns the accumulator into the line to store. Old files
// predate the boss-down event: without a single down line, "not downed"
// proves nothing, so Cleared stays unknown.
func finishSummary(accum *runAccum) *dungeonLogSummary {
	sum := accum.buildSummary()
	if sum == nil {
		sum = &dungeonLogSummary{Kind: "summary", SummaryVersion: summaryVersion}
	}
	if len(accum.downed) == 0 {
		for i := range sum.Fights {
			sum.Fights[i].Cleared = nil
		}
	}
	return sum
}

// backfillCurrent reports, without taking the lock, that path needs no
// work: its summary is current (and, for gz, mirrored in the header).
func backfillCurrent(path string) bool {
	if isGzBattleFile(path) {
		rc, err := openGzBattleReader(path)
		if err != nil {
			return true // unreadable: not ours to fix
		}
		defer rc.Close()
		_, sum, ok := parseGzExtra(rc.Extra())
		if !ok && isMarkedHeaderless(path) {
			return true // header did not fit; a rewrite would not add one
		}
		return ok && sum.SummaryVersion >= summaryVersion
	}
	f, err := os.Open(path)
	if err != nil {
		return true
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return true
	}
	sum, _, ok := readSummaryTail(f, info.Size())
	return ok && sum.SummaryVersion >= summaryVersion
}

// upgradeGzRecord recomputes the summary of a gz record (old version, or no
// header yet) and rewrites the gz through a verified temp file. Caller holds
// recordFileMu.
func upgradeGzRecord(path string) {
	rc, err := openGzBattleReader(path)
	if err != nil {
		return
	}
	br := bufio.NewReaderSize(rc, 1<<20)
	var (
		metaRaw, oldSumRaw []byte
		meta               dungeonLogMeta
		accum              *runAccum
		off, lastOff       int64
		lastLine           []byte
	)
	for {
		line, rerr := br.ReadBytes('\n')
		if t := bytes.TrimSpace(line); len(t) > 0 {
			if metaRaw == nil {
				if json.Unmarshal(t, &meta) != nil || meta.Kind != "meta" {
					rc.Close()
					return
				}
				metaRaw = append([]byte(nil), t...)
				accum = newRunAccum(meta.Tier)
			} else if e := decodeDungeonEvent(t); e != nil {
				accum.observe(e)
			}
			lastOff, lastLine = off, t
		}
		off += int64(len(line))
		if rerr != nil {
			if rerr != io.EOF {
				rc.Close()
				return
			}
			break
		}
	}
	rc.Close()
	if metaRaw == nil {
		return
	}
	var old dungeonLogSummary
	hasOld := json.Unmarshal(lastLine, &old) == nil && old.Kind == "summary"
	keepEnd := off // copy this much of the original stream
	if hasOld {
		keepEnd = lastOff
		oldSumRaw = append([]byte(nil), lastLine...)
	}
	sumRaw := oldSumRaw
	if !hasOld || old.SummaryVersion < summaryVersion {
		b, err := json.Marshal(finishSummary(accum))
		if err != nil {
			return
		}
		sumRaw = b
	}
	info, err := os.Stat(path)
	if err != nil {
		return
	}
	src, err := openGzBattleReader(path)
	if err != nil {
		return
	}
	tmpf, err := os.CreateTemp(filepath.Dir(path), filepath.Base(path)+".*.tmp")
	if err != nil {
		src.Close()
		return
	}
	tmp := tmpf.Name()
	fail := func(msg string, err error) {
		logger.Printf("battle-index: gz summary upgrade of %s failed (%s): %v", filepath.Base(path), msg, err)
		_ = os.Remove(tmp)
	}
	zw, _ := gzip.NewWriterLevel(tmpf, gzip.BestSpeed)
	zw.Extra = buildGzExtra(metaRaw, sumRaw)
	want := keepEnd + int64(len(sumRaw)) + 1
	_, err = io.CopyN(zw, src, keepEnd)
	src.Close() // the rename below replaces this very file
	if err == nil {
		_, err = zw.Write(append(append([]byte(nil), sumRaw...), '\n'))
	}
	if cerr := zw.Close(); err == nil {
		err = cerr
	}
	if serr := tmpf.Sync(); err == nil {
		err = serr
	}
	if cerr := tmpf.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		fail("write", err)
		return
	}
	if n, ok := gzUncompressedSize(tmp); !ok || n != want {
		fail("verify", fmt.Errorf("size %d, want %d", n, want))
		return
	}
	_ = os.Chtimes(tmp, info.ModTime(), info.ModTime())
	if err := os.Rename(tmp, path); err != nil {
		fail("rename", err)
		return
	}
	if zw.Extra == nil {
		markHeaderless(path)
	}
	logger.Printf("battle-index: upgraded summary of %s", filepath.Base(path))
}

// gzHeaderless remembers gz records (by size and mtime) whose meta+summary
// did not fit the gzip header, so backfill does not rewrite them every scan.
var gzHeaderless sync.Map

func headerlessKey(fi os.FileInfo) string {
	return fmt.Sprintf("%d|%d", fi.Size(), fi.ModTime().UnixNano())
}

func markHeaderless(path string) {
	if fi, err := os.Stat(path); err == nil {
		gzHeaderless.Store(path, headerlessKey(fi))
	}
}

func isMarkedHeaderless(path string) bool {
	v, ok := gzHeaderless.Load(path)
	if !ok {
		return false
	}
	fi, err := os.Stat(path)
	return err == nil && v.(string) == headerlessKey(fi)
}

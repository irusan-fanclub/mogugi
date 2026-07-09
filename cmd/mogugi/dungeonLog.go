package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/irusan-fanclub/mabidilmeter/lib/event"
)

// dungeonLogDirPath is the output dir for dungeon-event ndjson. A variable
// so tests can override it.
var dungeonLogDirPath = filepath.Join(_logDir, "dungeons")

// dungeonCodes: whitelisted dungeon missionId -> filename code. Currently
// only 布里萊赫 (Brileith); extend the whitelist as needed.
var dungeonCodes = map[uint32]string{
	717000: "brileith",
}

// dungeonLog, on entering a whitelisted dungeon, tees the event stream to
// dungeon_<code>_<player>_<enter-unix>.ndjson and closes on exit.
// Has its own lock; never reaches back for eventPublisher's lock (lock order).
type dungeonLog struct {
	mu sync.Mutex
	fd *os.File
}

// Open creates a new file and first writes initial (EntityAppear/condition/
// equip events from the entityCache snapshot) — teammates usually appeared
// before dungeon entry, so without seeding the file has only damage events
// that can't be matched back to player names. Closes any open file first.
func (d *dungeonLog) Open(code, owner string, ts int64, initial []event.IEvent) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.closeLocked()

	if err := os.MkdirAll(dungeonLogDirPath, 0o755); err != nil {
		return err
	}
	base := fmt.Sprintf("dungeon_%s_%s_%d", code, sanitizeEntityName(owner), ts)
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
	logger.Printf("dungeon-log: close %s", filepath.Base(d.fd.Name()))
	_ = d.fd.Sync()
	_ = d.fd.Close()
	d.fd = nil
}

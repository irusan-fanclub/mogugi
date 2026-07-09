package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/irusan-fanclub/mabidilmeter/lib/event"
)

// dungeonLogDirPath 是副本事件 ndjson 的輸出目錄。變數形式以便測試覆寫。
var dungeonLogDirPath = filepath.Join(_logDir, "dungeons")

// dungeonCodes：要獨立記錄的副本 missionId → 檔名代碼。
// 目前只錄布里萊赫；之後擴充白名單即可。
var dungeonCodes = map[uint32]string{
	717000: "brileith",
}

// dungeonLog 在進入白名單副本時，把事件流另存一份
// dungeon_<code>_<玩家名>_<進場unix>.ndjson，離開時關閉。
// 自帶鎖；絕不回頭拿 eventPublisher 的鎖（避免鎖序問題）。
type dungeonLog struct {
	mu sync.Mutex
	fd *os.File
}

// Open 建新檔並先寫入 initial（entityCache 快照的 EntityAppear/condition/
// 裝備事件）——隊友大多在進副本前就出現過，不補種的話檔內只有傷害事件、
// 對不回玩家名。已開啟時會先關閉舊檔。
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

// Write 追加一批事件；未開檔時為 no-op。與主 packet_log 相同，略過
// 負數（系統層）事件。
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

// IsOpen 回報目前是否有開啟中的記錄檔。
func (d *dungeonLog) IsOpen() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.fd != nil
}

// Close 關閉目前的檔（若有）。可重複呼叫。
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

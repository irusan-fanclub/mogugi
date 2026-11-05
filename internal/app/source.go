package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

// SourceState is where events currently come from.
type SourceState = event.SourceState

// ReplayOptions tunes a replay.
type ReplayOptions struct {
	// ImportBattles also writes battle records while replaying.
	ImportBattles bool
}

// captureHook pauses/resumes live capture around a replay.
type captureHook interface {
	Pause()
	Resume()
}

const progressInterval = 200 * time.Millisecond

// SourceController switches the publisher between live capture and a file.
type SourceController struct {
	pub  *eventPublisher
	ctx  context.Context
	hook captureHook

	mu       sync.Mutex
	state    SourceState
	// liveClient is the detected live game client version.
	liveClient string
	gen      int
	paused   bool
	lastEmit time.Time

	// ndjson feeder (nil when none runs)
	feedCancel context.CancelFunc
	feedDone   chan struct{}

	// pending import to register once the replay reaches clean EOF
	importSum, importFile string
	importReg             *importRegistry
}

func NewSourceController(srv *Server) *SourceController {
	c := &SourceController{pub: srv.Pub, ctx: srv.ctx, state: SourceState{Mode: "live"}}
	if c.ctx == nil {
		c.ctx = context.Background()
	}
	if srv.cap != nil {
		c.hook = srv.cap
	}
	return c
}

func (c *SourceController) State() SourceState {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.state
}

// liveStateLocked builds a live-mode state carrying the live client version.
func (c *SourceController) liveStateLocked(file, errMsg string) SourceState {
	return SourceState{Mode: "live", File: file, Err: errMsg, ClientVersion: c.liveClient}
}

// SetLiveClient records the live client version and emits when it changed
// while the source is live. Replays keep their own value.
func (c *SourceController) SetLiveClient(v string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pub.setLiveClient(v)
	if c.liveClient == v {
		return
	}
	c.liveClient = v
	if c.state.Mode == "live" {
		c.state.ClientVersion = v
		c.emitLocked()
	}
}

// emitLocked publishes the current state; the caller holds c.mu.
func (c *SourceController) emitLocked() {
	c.lastEmit = time.Now()
	e := &event.EventSourceChanged{
		EventBase:   event.EventBase{EventId: event.EventIdSourceChanged, At: time.Now().Unix(), Id: "0"},
		SourceState: c.state,
	}
	c.pub.sourceEvt.Store(e)
	c.pub.publish(e)
	c.pub.flushNow()
}

func (c *SourceController) fail(file string, err error) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	// A failed start also tears down any running replay.
	c.leaveReplayLocked()
	c.state = c.liveStateLocked(file, err.Error())
	c.emitLocked()
	return err
}

// leaveReplayLocked returns the publisher to live capture. Idempotent.
func (c *SourceController) leaveReplayLocked() {
	c.gen++
	c.stopFeederLocked()
	if !c.pub.readOnly.Load() && !c.pub.overlayGated.Load() && !c.paused {
		return
	}
	// Flags flip only after the replay forwarder is gone and the loop has
	// published whatever it was handling, or replay packets could write.
	c.pub.switchReader(nil, "live", true)
	c.pub.syncLoop()
	c.pub.flushNow()
	c.pub.SetReadOnly(false)
	c.pub.SetOverlayGated(false)
	c.pub.reseedOverlays()
	c.pub.SetImportBattles(false)
	if c.paused {
		c.paused = false
		if c.hook != nil {
			c.hook.Resume()
		}
	}
}

// StartReplay replays a capture file through the publisher. On error the
// source is back on live capture with State().Err set.
func (c *SourceController) StartReplay(path string, opt ReplayOptions) error {
	base := filepath.Base(path)
	isNdjson := false
	switch ext := strings.ToLower(filepath.Ext(path)); {
	case ext == ".pcapng", ext == ".pcap":
	case ext == ".ndjson", strings.HasSuffix(strings.ToLower(path), battleFileExtGz):
		isNdjson = true
	default:
		return c.fail(base, fmt.Errorf("不支援的檔案類型：%s", filepath.Ext(path)))
	}
	if _, err := os.Stat(path); err != nil {
		return c.fail(base, fmt.Errorf("無法開啟檔案：%w", err))
	}

	c.mu.Lock()
	c.gen++
	gen := c.gen
	c.mu.Unlock()

	if isNdjson {
		return c.startNdjson(path, base, opt, gen)
	}

	// Dedupe: hash outside c.mu (large files); only pcapng can import.
	doImport, pendSum, notice := opt.ImportBattles, "", ""
	var reg *importRegistry
	if opt.ImportBattles {
		sum, err := hashFile(path)
		if err != nil {
			return c.fail(base, fmt.Errorf("無法讀取封包檔：%w", err))
		}
		var lerr error
		reg, lerr = loadImportRegistry(importRegistryPath())
		if lerr != nil {
			logger.Println("import registry:", lerr)
		}
		if reg.Has(sum) {
			doImport, notice = false, importedNotice
			reg = nil
		} else {
			pendSum = sum
		}
	}

	r, err := packet.NewGameServerPacketReader(&packet.GameServerPacketReaderOpt{
		Ctx:           c.ctx,
		FileName:      path,
		NoCaptureFile: true,
		NoStartDelay:  true,
		Progress:      func(done, total int64) { c.onProgress(gen, done, total) },
	})
	if err != nil {
		return c.fail(base, fmt.Errorf("無法讀取封包檔：%w", err))
	}

	c.mu.Lock()
	if c.gen != gen { // superseded while opening
		c.mu.Unlock()
		r.Close()
		return fmt.Errorf("重播已被取消")
	}
	c.stopFeederLocked()
	if !c.paused {
		c.paused = true
		if c.hook != nil {
			c.hook.Pause()
		}
	}
	c.pub.SetReadOnly(true)
	c.pub.SetOverlayGated(true)
	c.pub.SetImportBattles(doImport)
	c.state = SourceState{Mode: "replay", File: base, Notice: notice}
	c.importSum, c.importFile, c.importReg = pendSum, base, reg
	c.pub.switchReader(r, "replay", true)
	c.emitLocked()
	c.mu.Unlock()

	go c.watchFinish(gen, r)
	return nil
}

func (c *SourceController) onProgress(gen int, done, total int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if gen != c.gen || c.state.Mode != "replay" {
		return
	}
	c.state.Done, c.state.Total = done, total
	if time.Since(c.lastEmit) >= progressInterval {
		c.emitLocked()
	}
}

// watchFinish marks the replay finished once the file is read and the
// publisher has handled every packet.
func (c *SourceController) watchFinish(gen int, r *packet.GameServerPacketReader) {
	select {
	case <-r.Finished():
	case <-c.ctx.Done():
		return
	}
	idle := 0
	for idle < 3 {
		time.Sleep(50 * time.Millisecond)
		if c.ctx.Err() != nil {
			return
		}
		if len(r.PacketCh()) == 0 && len(c.pub.packetCh) == 0 {
			idle++
		} else {
			idle = 0
		}
	}
	// Register before Finished is visible; only a clean EOF with game
	// packets counts.
	c.mu.Lock()
	var sum, file string
	var reg *importRegistry
	if gen == c.gen && c.state.Mode == "replay" && r.Err() == nil && c.pub.fwdCount.Load() > 0 {
		sum, file, reg = c.importSum, c.importFile, c.importReg
	}
	c.mu.Unlock()
	var regErr error
	if reg != nil && sum != "" {
		regErr = reg.Add(sum, file, time.Now())
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	if gen != c.gen || c.state.Mode != "replay" {
		return
	}
	c.state.Finished = true
	if regErr != nil {
		logger.Println("import registry save:", regErr)
		c.state.Notice = joinNotice(c.state.Notice, "無法記錄匯入狀態，下次重播可能重複匯入。")
	}
	if err := r.Err(); err != nil {
		c.state.Err = fmt.Sprintf("封包檔讀取中斷（檔案可能已損毀或不完整）：%v", err)
	} else if c.pub.fwdCount.Load() == 0 {
		c.state.Err = errNoGameContent
	} else if c.state.Total > 0 {
		c.state.Done = c.state.Total
	}
	if c.state.Err != "" {
		c.returnLiveWithErrLocked()
		return
	}
	c.emitLocked()
}

const errNoGameContent = "找不到瑪奇的封包或事件，這可能不是瑪奇的封包紀錄。"

// returnLiveWithErrLocked leaves a failed replay and resumes live capture,
// keeping Err in the broadcast state so the banner shows it.
func (c *SourceController) returnLiveWithErrLocked() {
	errMsg, file := c.state.Err, c.state.File
	c.leaveReplayLocked()
	c.state = c.liveStateLocked(file, errMsg)
	c.emitLocked()
}

// StopReplay returns to live capture; packets missed meanwhile are not backfilled.
func (c *SourceController) StopReplay() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.state.Mode != "replay" {
		return
	}
	c.leaveReplayLocked()
	c.state = c.liveStateLocked("", "")
	c.emitLocked()
}

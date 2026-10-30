package app

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
)

// backlogGiveUp bounds how long replay waits on a client that never drains.
var backlogGiveUp = 5 * time.Second

const ndjsonNoBattleNotice = "ndjson 事件紀錄無法匯入戰鬥紀錄，請改用 pcapng 封包檔。"

// ndjsonDecoders maps every persisted (positive) EventId to a fresh value.
// A new event type in lib/event must be added here; the round-trip test
// fails until it is.
var ndjsonDecoders = map[event.EventId]func() event.IEvent{
	event.EventIdEntityAppear:              func() event.IEvent { return &event.EventEntityAppear{} },
	event.EventIdEntityDisappear:           func() event.IEvent { return &event.EventEntityDisappear{} },
	event.EventIdDamage:                    func() event.IEvent { return &event.EventDamage{} },
	event.EventIdCharacterConditionEnable:  func() event.IEvent { return &event.EventCharacterConditionEnable{} },
	event.EventIdCharacterConditionDisable: func() event.IEvent { return &event.EventCharacterConditionDisable{} },
	event.EventIdFinish:                    func() event.IEvent { return &event.EventFinish{} },
	event.EventIdEntityEquipItem:           func() event.IEvent { return &event.EventEntityEquipItem{} },
	event.EventIdEntityUnequipItem:         func() event.IEvent { return &event.EventEntityUnequipItem{} },
	event.EventIdEntityUpdateBody:          func() event.IEvent { return &event.EventEntityUpdateBody{} },
	event.EventIdStatUpdate:                func() event.IEvent { return &event.EventStatUpdate{} },
	event.EventIdChat:                      func() event.IEvent { return &event.EventChat{} },
	event.EventIdNotice:                    func() event.IEvent { return &event.EventNotice{} },
	event.EventIdChangeStance:              func() event.IEvent { return &event.EventChangeStance{} },
	event.EventIdOwnerCharacter:            func() event.IEvent { return &event.EventOwnerCharacter{} },
	event.EventIdSkillCast:                 func() event.IEvent { return &event.EventSkillCast{} },
	event.EventIdBardsong:                  func() event.IEvent { return &event.EventBardsong{} },
	event.EventIdSkillUse:                  func() event.IEvent { return &event.EventSkillUse{} },
	event.EventIdSkillPrepareStart:         func() event.IEvent { return &event.EventSkillPrepareStart{} },
	event.EventIdSkillStop:                 func() event.IEvent { return &event.EventSkillStop{} },
	event.EventIdMaxLife:                   func() event.IEvent { return &event.EventMaxLife{} },
	event.EventIdEntityDown:                func() event.IEvent { return &event.EventEntityDown{} },
	event.EventIdCaptureStatus:             func() event.IEvent { return &event.EventCaptureStatus{} },
	event.EventIdOwnerEquipment:            func() event.IEvent { return &event.EventOwnerEquipment{} },
	event.EventIdOwnerStats:                func() event.IEvent { return &event.EventOwnerStats{} },
	event.EventIdBardsongPulse:             func() event.IEvent { return &event.EventBardsongPulse{} },
	event.EventIdEntityInvincible:          func() event.IEvent { return &event.EventEntityInvincible{} },
	event.EventIdClockShift:                func() event.IEvent { return &event.EventClockShift{} },
	event.EventIdOwnerProfile:              func() event.IEvent { return &event.EventOwnerProfile{} },
}

// decodeNdjsonEvent restores one packet-log line to its concrete event type.
// Unknown and runtime (negative) ids yield (nil, nil); bad JSON is an error.
func decodeNdjsonEvent(line []byte) (event.IEvent, error) {
	var probe struct{ EventId event.EventId }
	if err := json.Unmarshal(line, &probe); err != nil {
		return nil, err
	}
	mk, ok := ndjsonDecoders[probe.EventId]
	if !ok {
		return nil, nil
	}
	e := mk()
	if err := json.Unmarshal(line, e); err != nil {
		return nil, err
	}
	return e, nil
}

// stopFeederLocked cancels a running ndjson feeder and waits until it has
// left the publisher. The caller holds c.mu; the feeder only try-locks it.
func (c *SourceController) stopFeederLocked() {
	if c.feedCancel == nil {
		return
	}
	c.feedCancel()
	<-c.feedDone
	c.feedCancel, c.feedDone = nil, nil
}

// lockUnlessDone takes c.mu unless ctx is cancelled first (a stopper holds
// c.mu while waiting for the feeder).
func (c *SourceController) lockUnlessDone(ctx context.Context) bool {
	for !c.mu.TryLock() {
		if ctx.Err() != nil {
			return false
		}
		time.Sleep(time.Millisecond)
	}
	return true
}

func (c *SourceController) startNdjson(path, base string, opt ReplayOptions, gen int) error {
	f, err := openBattleFile(path)
	if err != nil {
		return c.fail(base, fmt.Errorf("無法開啟檔案：%w", err))
	}
	fi, err := os.Stat(path)
	if err != nil {
		f.Close()
		return c.fail(base, fmt.Errorf("無法開啟檔案：%w", err))
	}

	c.mu.Lock()
	if c.gen != gen { // superseded while opening
		c.mu.Unlock()
		f.Close()
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
	c.pub.SetImportBattles(false) // events carry no SetLocation, nothing to import
	c.state = SourceState{Mode: "replay", File: base, Total: fi.Size()}
	if opt.ImportBattles {
		c.state.Notice = ndjsonNoBattleNotice
	}
	c.pub.switchReader(nil, "replay", true)
	c.emitLocked()
	ctx, cancel := context.WithCancel(c.ctx)
	done := make(chan struct{})
	c.feedCancel, c.feedDone = cancel, done
	c.mu.Unlock()

	go func() {
		defer close(done)
		defer f.Close()
		c.feedNdjson(ctx, gen, f, fi.Size())
	}()
	return nil
}

// feedNdjson reads events and hands them to the publisher in batches,
// pausing whenever a client queue is half full so the WS fan-out never
// drops a slow client.
func (c *SourceController) feedNdjson(ctx context.Context, gen int, r io.Reader, total int64) {
	br := bufio.NewReaderSize(r, 1<<20)
	var read int64
	batch := make([]event.IEvent, 0, _maxPendingEvents)
	bad, known := 0, 0
	metaSeen := false
	var readErr error

	progress := func() {
		if !c.lockUnlessDone(ctx) {
			return
		}
		defer c.mu.Unlock()
		if gen != c.gen || c.state.Mode != "replay" {
			return
		}
		c.state.Done = read
		if pr, ok := r.(interface{ Pos() int64 }); ok {
			c.state.Done = pr.Pos() // gzip: progress counts compressed bytes
		}
		if time.Since(c.lastEmit) >= progressInterval {
			c.emitLocked()
		}
	}
	send := func() bool {
		waitStart := time.Now()
		for c.pub.clientsBacklogged() {
			if time.Since(waitStart) > backlogGiveUp {
				c.pub.dropBacklogged()
				break
			}
			select {
			case <-ctx.Done():
				return false
			case <-time.After(10 * time.Millisecond):
			}
		}
		if ctx.Err() != nil {
			return false
		}
		c.pub.PublishReplayEvents(batch)
		batch = batch[:0]
		progress()
		return true
	}

	for {
		if ctx.Err() != nil {
			return
		}
		line, err := br.ReadBytes('\n')
		read += int64(len(line))
		if line = bytes.TrimSpace(line); len(line) > 0 {
			if !metaSeen && bytes.HasPrefix(line, []byte(`{"Kind":"meta"`)) {
				metaSeen = true
				c.applyMeta(ctx, gen, line)
			}
			e, derr := decodeNdjsonEvent(line)
			switch {
			case derr != nil:
				bad++
			// Recorded capture health must not replace the live status.
			case e != nil && e.GetEventId() != event.EventIdCaptureStatus:
				batch = append(batch, e)
				known++
			}
		}
		if len(batch) >= _maxPendingEvents && !send() {
			return
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				readErr = err
			}
			break
		}
	}
	if len(batch) > 0 && !send() {
		return
	}
	c.pub.flushNow()

	if !c.lockUnlessDone(ctx) {
		return
	}
	defer c.mu.Unlock()
	if gen != c.gen || c.state.Mode != "replay" {
		return
	}
	c.state.Finished = true
	c.state.Done = total
	switch {
	case readErr != nil:
		c.state.Err = fmt.Sprintf("紀錄檔讀取中斷：%v", readErr)
	case known == 0:
		c.state.Err = errNoGameContent
	case bad > 0:
		msg := fmt.Sprintf("有 %d 行無法解析，已略過（檔案可能已損毀或不完整）。", bad)
		if c.state.Notice != "" {
			msg = c.state.Notice + msg
		}
		c.state.Notice = msg
	}
	if c.state.Err != "" {
		// This goroutine is the feeder: detach so leaving does not wait on itself.
		c.feedCancel, c.feedDone = nil, nil
		c.returnLiveWithErrLocked()
		return
	}
	c.emitLocked()
}

// applyMeta shows the recorded client version of a run file in the state.
func (c *SourceController) applyMeta(ctx context.Context, gen int, line []byte) {
	var meta dungeonLogMeta
	if json.Unmarshal(line, &meta) != nil || meta.Client == "" {
		return
	}
	if !c.lockUnlessDone(ctx) {
		return
	}
	defer c.mu.Unlock()
	if gen != c.gen || c.state.Mode != "replay" {
		return
	}
	c.state.ClientVersion = meta.Client
	c.emitLocked()
}

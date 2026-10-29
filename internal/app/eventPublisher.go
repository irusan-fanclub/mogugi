package app

import (
	"context"
	"encoding/binary"
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
	"runtime/debug"
)

const (
	// Batch up events until we hit this count or the flush interval.
	_maxPendingEvents   = 100
	_eventFlushInterval = 100 * time.Millisecond
)

type eventPublisher struct {
	sync.Mutex

	// non-mutable
	ctx       context.Context
	clientMap map[uint32]*eventClient
	packetCh  chan *packet.GamePacket
	// fwdCount counts packets forwarded since the last reader switch.
	fwdCount atomic.Int64

	// mutable (guarded by the embedded mutex)
	r               *packet.GameServerPacketReader
	fwdCancel       context.CancelFunc
	fwdDone         chan struct{}
	entityCache     entityCache
	clock           serverClock // server−local offset estimate
	clockGen        int         // shifts published; never reset, so a front that kept its actors across a reset still applies later shifts
	currentClientId uint32
	pendingEvents   []event.IEvent
	lastSentAt      time.Time
	lastPacketAt    time.Time
	// lastRealPacketAt is a genuine packet-receipt signal: set only in
	// loop()'s packet path, never by the constructor or SwitchReader (which
	// both stamp lastPacketAt for the idle-retry grace period, not liveness).
	lastRealPacketAt time.Time
	lastRegion       uint32                          // current region id (26009); 0 = unknown
	lastRegionName   string                          // resolved display name of lastRegion (for "from X" logging)
	lastMission      string                          // latest mission code (22007 enter_<code>), e.g. mrd
	lastMissionID    uint32                          // latest mission id (36000 kind-7 quest entry); resolves via dungeonNames
	lastMissionName  string                          // mission display name carried by the same 36000 entry
	lastBGM          string                          // currently playing BGM (43302); Boss_* means a boss fight
	bossEntities     map[uint64]string               // live boss entity id -> boss name (race-id detection)
	lifeSeen         map[uint64]lifeState            // boss id -> current life throttle state (0x7532)
	maxLifeSeen      map[uint64]float64              // entity id -> last published max life (0x7532)
	downedEntities   map[uint64]bool                 // boss ids whose life already crossed zero
	deadPlayers      map[uint64]int64                // player id -> death time, while dead
	invincible       map[uint64]int64                // boss id -> invincible since (0x7533), while on
	bardsongNow      float64                         // latest packet time (local sec) seen by the buff expiry sweep
	bardsongBuffs    map[uint64]bardsongBuff         // target id -> active synthetic 戰吼 (CC 900206)
	captureStatus    *event.EventCaptureStatus       // last known capture status; nil until the watchdog computes one
	snapshotNames    map[uint64]string               // entity id -> name from 0x5209 snapshots (survives cache eviction)
	dynRegions       map[uint32]dynRegion            // dynamic region id -> static region it clones (0xA9A0)
	statTables       map[uint64]packet.StatTable     // entity id -> stat table (0x5209 base + 0x7530/2 deltas)
	dgnLog           dungeonLog                      // per-run event file for whitelisted dungeons (own lock)
	ownerId          uint64                          // local player's own entity id (0 = unknown)
	ownerName        string                          // local player's own character name ("" = unknown)
	ownerItems       map[uint64]packet.InventoryItem // local character's items by ItemEID (0x5209 + equip changes); nil until a snapshot
	lastOwnerPanel   *packet.Panel                   // last EventOwnerStats payload, for dedupe
	lastOwnerStatsAt int64                           // unix-second of lastOwnerPanel's publish, for the current-value throttle
	lastOwnerEquip   []event.EquipmentItem           // last EventOwnerEquipment.Items published, for dedupe
	preparingSkill   uint16                          // skillId from the last 0x6984; consumed and cleared by 0x698B
	// Last published skill use, for collapsing the server's double-send of
	// one cast (two combat packs 0-3ms apart) into a single event.
	lastSkillUseBy uint64
	lastSkillUseId uint16
	lastSkillUseAt time.Time

	// Replay: read-only blocks item-index writes (and battle records unless
	// importBattles); sourceEvt is the latest SourceChanged for new clients.
	handleMu      sync.Mutex               // held while the loop handles one packet (see syncLoop)
	onPacket      func(*packet.GamePacket) // test hook, runs before handlePacket
	onReplayBatch func()                   // test hook, runs inside PublishReplayEvents
	readOnly      atomic.Bool
	liveClient    atomic.Pointer[string]
	importBattles atomic.Bool
	sourceEvt     atomic.Pointer[event.EventSourceChanged]

	// hist is the bounded event history of the current source (guarded by the mutex).
	hist eventHistory
	// inWhitelistRun is true while inside a whitelisted dungeon run.
	inWhitelistRun atomic.Bool
}

// dynRegion is the static region a dynamic dungeon instance was cloned from.
type dynRegion struct {
	baseId   uint32
	baseName string
}

type eventClient struct {
	ctx context.Context
	ch  chan<- []event.IEvent
	// skipReadOnly clients (the packet-log writer) get nothing while a
	// replay is read-only, decided at flush time.
	skipReadOnly bool
	// filter, when set, drops events it rejects (negative system ids always pass).
	filter func(event.IEvent) bool
}

// historyOpts selects what a history client receives: only the current
// battle segment, and/or only events accepted by filter.
type historyOpts struct {
	currentOnly bool
	filter      func(event.IEvent) bool
}

// overlayWants keeps the types the overlay page consumes via ActorManager: appear/disappear
// (names, races, owners), damage, CC enable/disable/finish, life/max life/death, skill use
// and owner character. Equip, stats, chat, bardsong, casts etc. are never read by overlays.
func overlayWants(e event.IEvent) bool {
	switch e.GetEventId() {
	case event.EventIdEntityAppear, event.EventIdEntityDisappear, event.EventIdDamage,
		event.EventIdCharacterConditionEnable, event.EventIdCharacterConditionDisable,
		event.EventIdFinish, event.EventIdOwnerCharacter, event.EventIdSkillUse,
		event.EventIdMaxLife, event.EventIdEntityLife, event.EventIdEntityDeath:
		return true
	}
	return false
}

// dedupeSnapshotConditions drops snapshot condition enables that the chunks re-enable (the
// client would count both as casts). The rest predate the segment: they are stamped
// `at` (0 makes any phantom cast long ready, so the cooldown rows drop it; a
// truncated full history uses its oldest kept start to keep timelines bounded).
func dedupeSnapshotConditions(ents []event.IEvent, chunks [][]event.IEvent, at int64) []event.IEvent {
	type key struct {
		id string
		cc uint32
	}
	seen := make(map[key]bool)
	for _, c := range chunks {
		for _, e := range c {
			if ce, ok := e.(*event.EventCharacterConditionEnable); ok {
				seen[key{ce.Id, ce.CCId}] = true
			}
		}
	}
	out := ents[:0]
	for _, e := range ents {
		if ce, ok := e.(*event.EventCharacterConditionEnable); ok {
			if seen[key{ce.Id, ce.CCId}] {
				continue
			}
			ce.At = at
		}
		out = append(out, e)
	}
	return out
}

// filterEvents returns evs itself when nothing is dropped, else a new slice.
func filterEvents(evs []event.IEvent, f func(event.IEvent) bool) []event.IEvent {
	if f == nil {
		return evs
	}
	pass := func(e event.IEvent) bool { return e.GetEventId() < 0 || f(e) }
	for i, e := range evs {
		if pass(e) {
			continue
		}
		out := append(make([]event.IEvent, 0, len(evs)-1), evs[:i]...)
		for _, e := range evs[i+1:] {
			if pass(e) {
				out = append(out, e)
			}
		}
		return out
	}
	return evs
}

var le = binary.LittleEndian

func newEventPublisher(ctx context.Context, r *packet.GameServerPacketReader) *eventPublisher {
	v := &eventPublisher{
		ctx:             ctx,
		r:               r,
		clientMap:       make(map[uint32]*eventClient),
		packetCh:        make(chan *packet.GamePacket, 100),
		entityCache:     make(entityCache),
		currentClientId: 1,
		pendingEvents:   make([]event.IEvent, 0, _maxPendingEvents),
		bossEntities:    make(map[uint64]string),
		maxLifeSeen:     make(map[uint64]float64),
		lifeSeen:        make(map[uint64]lifeState),
		downedEntities:  make(map[uint64]bool),
		deadPlayers:     make(map[uint64]int64),
		invincible:      make(map[uint64]int64),
		lastSentAt:      time.Now(),
		lastPacketAt:    time.Now(),
	}

	v.startForwarder()
	go v.loop()

	return v
}

// startForwarder spawns a goroutine that bridges the current reader's
// packet channel into the publisher's internal packetCh. This indirection
// is what makes hot-swapping the reader (channel switch) possible.
//
// Caller must hold no locks; this method takes the lock internally.
func (t *eventPublisher) startForwarder() {
	fwdCtx, cancel := context.WithCancel(t.ctx)
	done := make(chan struct{})

	t.Lock()
	t.fwdCancel = cancel
	t.fwdDone = done
	r := t.r
	t.Unlock()

	if r == nil {
		cancel()
		close(done)
		return
	}

	go func() {
		defer close(done)
		ch := r.PacketCh()
		for {
			select {
			case <-fwdCtx.Done():
				return
			case p, ok := <-ch:
				if !ok {
					return
				}
				select {
				case <-fwdCtx.Done():
					return
				case t.packetCh <- p:
					t.fwdCount.Add(1)
				}
			}
		}
	}()
}

// SwitchReader closes the current reader, swaps in the new one, drains
// any unprocessed packets that were buffered from the old connection,
// and (when replacing an existing reader) broadcasts a SessionReset
// event so the UI can show a notification.
//
// Per-session state (entityCache, pendingEvents, frontend caches) is
// intentionally preserved — the user wants to keep accumulated data
// across channel switches.
//
// At lazy startup the publisher is created with a nil reader; the first
// SwitchReader call installs the real one. In that case there's no
// session to reset, so the broadcast is suppressed.
func (t *eventPublisher) SwitchReader(newR *packet.GameServerPacketReader, reason string) {
	t.switchReader(newR, reason, false)
}

// SetReadOnly toggles replay mode: no item-index writes, and no battle
// records unless SetImportBattles(true).
func (t *eventPublisher) SetReadOnly(on bool) { t.readOnly.Store(on) }

func (t *eventPublisher) setLiveClient(v string) { t.liveClient.Store(&v) }

// dungeonClient is the client version to stamp on a run: blank while
// replaying, so imports never carry this machine's version.
func (t *eventPublisher) dungeonClient() string {
	if t.readOnly.Load() {
		return ""
	}
	if v := t.liveClient.Load(); v != nil {
		return *v
	}
	return ""
}

// SetImportBattles lets a read-only replay still write battle records.
func (t *eventPublisher) SetImportBattles(on bool) { t.importBattles.Store(on) }

// storesItems reports whether item-index writes are allowed right now.
func (t *eventPublisher) storesItems() bool { return itemDB != nil && !t.readOnly.Load() }

// switchReader is SwitchReader; forceReset also announces a reset when
// there was no previous reader (live idle -> replay).
func (t *eventPublisher) switchReader(newR *packet.GameServerPacketReader, reason string, forceReset bool) {
	t.Lock()
	oldR := t.r
	oldCancel := t.fwdCancel
	oldDone := t.fwdDone
	t.r = newR
	t.lastPacketAt = time.Now()
	t.Unlock()

	if oldCancel != nil {
		oldCancel()
	}
	if oldR != nil {
		oldR.Close()
	}
	if oldDone != nil {
		<-oldDone
	}

	// Drop any packets already buffered from the old reader — they
	// belong to the previous connection and would be parsed against
	// stale TCP sequence state.
	drained := 0
drainLoop:
	for {
		select {
		case <-t.packetCh:
			drained++
		default:
			break drainLoop
		}
	}
	if drained > 0 {
		logger.Printf("SwitchReader: dropped %d in-flight packet(s)", drained)
	}

	t.fwdCount.Store(0)
	t.startForwarder()

	if oldR == nil && !forceReset {
		logger.Printf("Initial reader installed (reason=%s)", reason)
		return
	}

	// Connection restarted; the dungeon log is void (where it cut off is
	// self-evident in the file).
	t.dgnLog.Close()

	// Flush first so old-source events still pending cannot land after the reset.
	resetHist := reason == "replay" || reason == "live"
	if resetHist {
		t.flushNow()
	}
	t.Lock()
	t.ownerItems = nil
	t.lastOwnerPanel = nil
	t.lastOwnerStatsAt = 0
	t.lastOwnerEquip = nil
	t.clock = serverClock{}
	t.bardsongBuffs = nil
	t.bardsongNow = 0
	if resetHist {
		t.hist.reset()
		t.inWhitelistRun.Store(false)
	}
	t.Unlock()

	logger.Printf("SessionReset: reason=%s", reason)
	t.publish(&event.EventSessionReset{
		EventBase: event.EventBase{
			EventId: event.EventIdSessionReset,
			At:      time.Now().Unix(),
			Id:      "0",
		},
		Reason: reason,
	})
}

// SetReaderFilter updates the current reader's live capture filter.
func (t *eventPublisher) SetReaderFilter(filter string) error {
	t.Lock()
	r := t.r
	t.Unlock()
	if r == nil {
		return nil
	}
	return r.SetFilter(filter)
}

// LastPacketAt returns the timestamp of the most recently received
// game packet. The connection watchdog uses this for idle detection.
func (t *eventPublisher) LastPacketAt() time.Time {
	t.Lock()
	defer t.Unlock()
	return t.lastPacketAt
}

// LastRealPacketAt is the zero Time until a genuine packet arrives, then
// its time — unlike LastPacketAt, SwitchReader/the constructor never touch
// it, so it's safe as a "capturing" liveness signal.
func (t *eventPublisher) LastRealPacketAt() time.Time {
	t.Lock()
	defer t.Unlock()
	return t.lastRealPacketAt
}

// PublishCaptureStatus stores the given status for new clients' initial
// snapshot and broadcasts it live. Called by the watchdog on state change.
func (t *eventPublisher) PublishCaptureStatus(s event.EventCaptureStatus) {
	s.EventBase = event.EventBase{
		EventId: event.EventIdCaptureStatus,
		At:      time.Now().Unix(),
		Id:      "0",
	}

	t.Lock()
	t.captureStatus = &s
	t.Unlock()

	t.publish(&s)
}

// CaptureStatus returns the last known capture status, or nil if the
// watchdog hasn't computed one yet (e.g. license not yet activated).
func (t *eventPublisher) CaptureStatus() *event.EventCaptureStatus {
	t.Lock()
	defer t.Unlock()
	return t.captureStatus
}

// publish appends an event to the pending buffer and triggers a flush
// when the buffer fills up or the flush interval elapses.
func (t *eventPublisher) publish(e event.IEvent) {
	t.Lock()
	t.pendingEvents = append(t.pendingEvents, e)
	sendNow := len(t.pendingEvents) >= _maxPendingEvents ||
		time.Since(t.lastSentAt) >= _eventFlushInterval
	t.Unlock()

	if sendNow {
		t.flushNow()
	}
}

// PublishReplayEvents feeds replayed events through the same publish path as
// live ones (batching, flush, dungeon-log tee). Holding handleMu makes
// syncLoop a barrier against a feeder that is mid-batch.
func (t *eventPublisher) PublishReplayEvents(evs []event.IEvent) {
	t.handleMu.Lock()
	defer t.handleMu.Unlock()
	if t.onReplayBatch != nil {
		t.onReplayBatch()
	}
	for _, e := range evs {
		t.publish(e)
	}
	t.flushNow()
}

// clientsBacklogged reports whether any live client queue is half full.
// Clients whose ctx is done are reaped here, not counted.
func (t *eventPublisher) clientsBacklogged() bool {
	t.Lock()
	defer t.Unlock()
	backlogged := false
	for k, c := range t.clientMap {
		if c.ctx.Err() != nil {
			delete(t.clientMap, k)
			continue
		}
		if !c.skipReadOnly && len(c.ch)*2 >= cap(c.ch) {
			backlogged = true
		}
	}
	return backlogged
}

// dropBacklogged force-closes clients that are still half full, like
// flushNow does for a full queue.
func (t *eventPublisher) dropBacklogged() {
	t.Lock()
	defer t.Unlock()
	for k, c := range t.clientMap {
		if !c.skipReadOnly && len(c.ch)*2 >= cap(c.ch) {
			delete(t.clientMap, k)
			logger.Println("replay: client stuck backlogged, force close socket", k)
		}
	}
}

// flushNow drains the pending buffer and broadcasts it to every client.
// Slow clients (full channel) are dropped to keep the publisher non-blocking.
func (t *eventPublisher) flushNow() {
	t.Lock()
	if len(t.pendingEvents) == 0 {
		t.Unlock()
		return
	}
	batch := t.pendingEvents
	t.pendingEvents = make([]event.IEvent, 0, _maxPendingEvents)
	t.lastSentAt = time.Now()
	boundaries, evictedBefore := t.hist.append(batch)
	out := batch
	if len(boundaries) > 0 || evictedBefore > 0 {
		// System events go to clients only; they never enter history.
		out = append(make([]event.IEvent, 0, len(batch)+len(boundaries)+1), batch...)
		t.pruneStrayLocked()
		present := t.presentIdsLocked()
		for _, at := range boundaries {
			out = append(out, &event.EventBattleBoundary{EventBase: event.EventBase{EventId: event.EventIdBattleBoundary, At: at}, Present: present})
		}
		if evictedBefore > 0 {
			out = append(out, &event.EventHistoryEvicted{EventBase: event.EventBase{EventId: event.EventIdHistoryEvicted, At: evictedBefore}, Present: present})
		}
	}

	for k, c := range t.clientMap {
		select {
		case <-c.ctx.Done():
			delete(t.clientMap, k)
			continue
		default:
		}

		if c.skipReadOnly && t.readOnly.Load() {
			continue
		}
		send := filterEvents(out, c.filter)
		if len(send) == 0 {
			continue
		}
		select {
		case c.ch <- send:
		default:
			delete(t.clientMap, k)
			logger.Println("queue full... force close socket", k)
		}
	}
	t.Unlock()

	// Dungeon log (writes only when open; has its own lock, so never call
	// while holding the publisher lock).
	t.dgnLog.Write(batch)
}

// SetMemoryLimitMB sets the history byte budget; 0 means the default.
func (t *eventPublisher) SetMemoryLimitMB(mb int) {
	t.Lock()
	t.hist.setBudget(int64(memoryLimitOrDefault(mb)) << 20)
	t.Unlock()
}

// markBattleBoundary flushes pending events into the old segment, opens a new
// one at `at` and tells clients. Must not be called with the lock held.
func (t *eventPublisher) markBattleBoundary(at int64, pinned bool) {
	t.flushNow()
	t.Lock()
	t.hist.startSegment(at, pinned)
	t.pruneStrayLocked()
	present := t.presentIdsLocked()
	t.Unlock()
	t.publish(&event.EventBattleBoundary{EventBase: event.EventBase{EventId: event.EventIdBattleBoundary, At: at}, Present: present})
}

// presentIdsLocked lists the entityCache ids in EntityAppear's string form.
// Caller holds the lock.
func (t *eventPublisher) presentIdsLocked() []string {
	ids := make([]string, 0, len(t.entityCache))
	for id := range t.entityCache {
		ids = append(ids, strconv.FormatUint(id, 10))
	}
	return ids
}

// pruneStrayLocked drops per-entity state for ids that never entered
// entityCache (nameless or '_' appears), which forgetEntitiesLocked cannot
// reach. bossEntities is left alone (recorded before that early return, cleared
// on disappear) and so is the life state of its ids. Caller holds the lock.
func (t *eventPublisher) pruneStrayLocked() {
	stray := func(id uint64) bool {
		if id == t.ownerId {
			return false
		}
		_, ok := t.entityCache[id]
		return !ok
	}
	strayLife := func(id uint64) bool {
		_, boss := t.bossEntities[id]
		return !boss && stray(id)
	}
	for id := range t.lifeSeen {
		if strayLife(id) {
			delete(t.lifeSeen, id)
		}
	}
	for id := range t.downedEntities {
		if strayLife(id) {
			delete(t.downedEntities, id)
		}
	}
	for id := range t.statTables {
		if stray(id) {
			delete(t.statTables, id)
		}
	}
	for id := range t.maxLifeSeen {
		if stray(id) {
			delete(t.maxLifeSeen, id)
		}
	}
	for id := range t.deadPlayers {
		if stray(id) {
			delete(t.deadPlayers, id)
		}
	}
	for id := range t.invincible {
		if stray(id) {
			delete(t.invincible, id)
		}
	}
	for id := range t.bardsongBuffs {
		if stray(id) {
			delete(t.bardsongBuffs, id)
		}
	}
}

func (t *eventPublisher) loop() {
	flushTicker := time.NewTicker(_eventFlushInterval / 2)
	defer flushTicker.Stop()

	for {
		select {
		case <-t.ctx.Done():
			t.dgnLog.Close()
			return

		case <-flushTicker.C:
			t.flushNow()

		case p := <-t.packetCh:
			now := time.Now()
			t.Lock()
			t.lastPacketAt = now
			t.lastRealPacketAt = now
			t.Unlock()

			t.handleMu.Lock()
			if t.onPacket != nil {
				t.onPacket(p)
			}
			t.handlePacket(p)
			t.handleMu.Unlock()
		}
	}
}

// syncLoop returns once the loop is not mid-packet, so everything it handled
// before the call has been published.
func (t *eventPublisher) syncLoop() {
	t.handleMu.Lock()
	t.handleMu.Unlock() //nolint:staticcheck // barrier only
}

func (t *eventPublisher) handlePacket(p *packet.GamePacket) {
	// A parser panic must cost one packet, not the whole meter; the raw
	// stream can always carry layout surprises.
	defer func() {
		if rec := recover(); rec != nil {
			logger.Printf("handlePacket panic (op=%v): %v\n%s", p.Op, rec, debug.Stack())
		}
	}()

	t.expireBardsongBuffs(p.At)

	switch p.Op {
	case 0:
		// short packet; nothing to do
		return

	case packet.OpcodeEntityAppear:
		t.handleEntityAppear(p)

	case packet.OpcodeEntityDisappear:
		t.handleEntityDisappear(p)

	case packet.OpcodeCreatureBodyUpdate:
		t.handleCreatureBodyUpdate(p)

	case packet.OpcodeEntitiesAppear:
		t.handleEntitiesAppear(p)

	case packet.OpcodeEntitiesDisappear:
		t.handleEntitiesDisappear(p)

	case packet.OpcodeEquipmentChanged:
		t.handleEquipmentChanged(p)

	case packet.OpcodeUnequipment:
		t.handleUnequipment(p)

	case packet.OpcodeItemMove:
		t.handleOwnerItemMove(p)

	case packet.OpcodeItemAdd, packet.OpcodeItemRecordSingle:
		t.handleOwnerItemRecord(p)

	case packet.OpcodeSetFinisher:
		t.handleSetFinisher(p)

	case packet.OpcodeCombatAction:
		t.handleCombatAction(p)

	case packet.OpcodeEffectDelayed:
		t.handleEffectDelayed(p)

	case packet.OpcodeCharacterConditionUpdate:
		t.handleConditionUpdate(p)

	case packet.OpcodeChat:
		t.handleChat(p)

	case packet.OpcodeNotice:
		t.handleNotice(p)

	case packet.OpcodeStatUpdatePublic:
		t.handleStatUpdate(p)
		t.handleStatTable(p)

	case packet.OpcodeIsNowDead:
		t.handleDeath(p, true)

	case packet.OpcodeRemoveDeathScreen:
		t.handleDeath(p, false)

	case packet.OpcodeEntityInvincible:
		t.handleInvincible(p)

	// Owner-only, and the only source of stat *changes* — the full table
	// arrives once, in the 0x5209 snapshot.
	case packet.OpcodeStatUpdatePrivate:
		t.handleStatTable(p)

	case packet.OpcodeMissionState:
		t.handleMissionState(p)

	case packet.OpcodeMissionStart:
		t.handleMissionStart(p)

	case packet.OpcodeQuestInfo:
		t.handleQuestInfo(p)

	// BGM-based boss detection disabled (race-id detection is primary);
	// handleBGMPlay kept for now.
	// case packet.OpcodeBGMPlay:
	// 	t.handleBGMPlay(p)

	// Must precede the 26009 that warps us in, and it does (1.1s earlier in
	// capture 1785312528).
	case packet.OpcodeDynamicRegionList:
		t.handleDynamicRegionList(p)

	case packet.OpcodeSetLocation:
		t.handleSetLocation(p)

	case packet.OpcodeEffect2:
		t.handleSkillCast(p)
		t.handleBardsongPulse(p)

	case packet.OpcodeSkillPrepareStart:
		t.handleSkillPrepareStart(p)

	case packet.OpcodeSkillStop:
		t.handleSkillStop(p)

	case packet.OpcodeChangeStance, packet.OpcodeChangeStanceRes:
		t.handleChangeStance(p)

	case packet.OpcodeChannelCharacterInfoR:
		t.handleChannelCharacterInfo(p)

	case packet.OpcodeBeautyRoomList:
		t.handleBeautyRoom(p)

	case packet.OpcodeBankList:
		t.handleBankList(p)
	}
}

// handleChannelCharacterInfo parses an owner-only 0x5209 snapshot and writes
// the entity's inventory to the item store. This is a side-effect-only path
// (no client event); any failure is logged and ignored so metering is never
// disturbed.
func (t *eventPublisher) handleChannelCharacterInfo(p *packet.GamePacket) {
	t.handleStatTable(p)

	snap, err := packet.ParseEntitySnapshot(p.Msg)
	if err != nil {
		itemLogger.Printf("parse 0x5209 failed: %v", err)
		return
	}
	// Own-character snapshots must update the owner even when the entity
	// is filtered from storage below (world-id copies can't reach this id
	// block, so checking it unconditionally here is safe).
	if snap.Name != "" && isOwnCharacterId(snap.Id) {
		t.setOwnerCharacter(snap.Id, snap.Name)
		t.Lock()
		stats := t.ownerStatsIfChangedLocked(p.At.Unix())
		t.Unlock()
		if stats != nil {
			t.publish(stats)
		}
		// An empty snapshot keeps the previous set, like the item store does.
		if len(snap.Items) > 0 {
			t.Lock()
			t.setOwnerItemsLocked(snap.Items)
			t.Unlock()
			t.publishOwnerEquipment(p.At.Unix())
		}
	}
	if !shouldStoreSnapshot(snap) {
		return
	}
	if snap.Id != 0 && snap.Name != "" {
		t.rememberSnapshotName(snap.Id, snap.Name)
	}
	if !t.storesItems() {
		return
	}
	entityId := int64(snap.Id)
	if len(snap.Items) == 0 {
		if n, err := itemDB.CountItems(entityId, "inventory"); err == nil && n > 0 {
			itemLogger.Printf("skip empty snapshot for %q (existing inventory kept)", snap.Name)
			return
		}
	}
	meta := entityMeta{Id: entityId, Name: snap.Name, Master: snap.Master, RaceId: snap.RaceId}
	if err := itemDB.ReplaceStorage(meta, "inventory", snap.Items); err != nil {
		itemLogger.Printf("write store failed: %v", err)
		return
	}
	itemLogger.Printf("update %q (%d items)", snap.Name, len(snap.Items))
}

// rememberSnapshotName records an id -> name seen in a 0x5209 snapshot.
// Beauty-room owner lookup falls back to it: when mogugi starts mid-session
// the character never re-appears, so entityCache alone misses the owner.
func (t *eventPublisher) rememberSnapshotName(id uint64, name string) {
	t.Lock()
	defer t.Unlock()
	if t.snapshotNames == nil {
		t.snapshotNames = make(map[uint64]string)
	}
	t.snapshotNames[id] = name
}

// handleBeautyRoom writes the 0x96CA beauty-room list to the item store
// under the character's own entity as storage="beauty", overwritten on
// every open, like a 0x5209 snapshot.
func (t *eventPublisher) handleBeautyRoom(p *packet.GamePacket) {
	items, declared, account, err := packet.ParseBeautyRoomPacket(p.Msg)
	if err != nil {
		itemLogger.Printf("beauty room: ignore packet: %v", err)
		return
	}
	if int(declared) != len(items) {
		itemLogger.Printf("beauty room: declared %d items, parsed %d", declared, len(items))
	}
	// Schema drift guard: an all-miss parse must not wipe existing data.
	if declared > 0 && len(items) == 0 {
		return
	}

	t.Lock()
	var owner string
	var raceId uint32
	if e, ok := t.entityCache[p.Id]; ok {
		owner = e.Name
		raceId = e.RaceId
	}
	if owner == "" {
		owner = t.snapshotNames[p.Id]
	}
	t.Unlock()
	if owner == "" {
		itemLogger.Printf("beauty room: owner of id=%d unknown, skip write (%d items parsed)", p.Id, len(items))
		return
	}

	if !t.storesItems() {
		return
	}
	meta := entityMeta{Id: int64(p.Id), Name: owner, RaceId: raceId}
	if err := itemDB.ReplaceStorage(meta, "beauty", items); err != nil {
		itemLogger.Printf("beauty room: write store failed: %v", err)
		return
	}
	itemLogger.Printf("update %q beauty (%d items)", owner, len(items))

	if account != "" {
		if err := itemDB.SetAccountById(int64(p.Id), accountHash(account)); err != nil {
			itemLogger.Printf("beauty room: set account failed: %v", err)
		}
	}
}

// handleBankList writes one 0x7212 bank page to the item store under a
// synthetic per-account entity (a physical bank has no character owner),
// and backfills the account onto the viewer, tab-owner, and bank entities.
func (t *eventPublisher) handleBankList(p *packet.GamePacket) {
	b, err := packet.ParseBankListPacket(p.Msg)
	if err != nil {
		itemLogger.Printf("bank: parse failed: %v", err)
		return
	}
	if !t.storesItems() {
		return
	}
	if b.Account == "" { // empty account would mint a junk bank_<hash> entity and wipe learned accounts
		itemLogger.Printf("bank: empty account id, skip")
		return
	}

	acctHash := accountHash(b.Account)
	acct := entityMeta{Id: bankEntityId(b.Account), Name: "bank_" + acctHash}
	tabOwners := make([]string, 0, len(b.Tabs))
	totalItems := 0
	for _, tab := range b.Tabs {
		tabOwners = append(tabOwners, tab.Owner)
		// Schema drift guard: an all-miss parse must not wipe an existing tab.
		if tab.Declared > 0 && len(tab.Items) == 0 {
			itemLogger.Printf("bank: tab %q declared %d items, parsed 0, skip", tab.Owner, tab.Declared)
			continue
		}
		if err := itemDB.ReplaceBankTab(acct, tab.Owner, tab.Items); err != nil {
			itemLogger.Printf("bank: write tab %q failed: %v", tab.Owner, err)
			continue
		}
		totalItems += len(tab.Items)
	}

	if err := itemDB.SetAccountById(int64(p.Id), acctHash); err != nil {
		itemLogger.Printf("bank: set account for viewer failed: %v", err)
	}
	if err := itemDB.SetAccountByNames(acctHash, tabOwners); err != nil {
		itemLogger.Printf("bank: set account for tab owners failed: %v", err)
	}
	if err := itemDB.SetAccountById(acct.Id, acctHash); err != nil {
		itemLogger.Printf("bank: set account for bank entity failed: %v", err)
	}

	itemLogger.Printf("bank: page %d, %d tabs, %d items (account %s)", b.Page, len(b.Tabs), totalItems, acctHash)
}

// isSummonRace reports whether a race id belongs to the summoned-unit block:
// marionettes (小丑人偶 / 巨像人偶 / 人類型-精靈型-巨人型), alchemy hellhounds and the
// like. They send a 0x5209 snapshot like any owned entity but hold no
// inventory worth indexing, and their name is the bare entity id, so each one
// would leave its own junk file behind. Player characters, pets, mounts and
// partners all live outside this block.
//
// A race id of 0 means the snapshot head didn't parse; those are kept.
func isSummonRace(raceId uint32) bool {
	return raceId >= 990000 && raceId < 991000
}

// worldEntityIdBase marks the start of the world/NPC entity id block
// (verified stable across sessions); owned entities never reach it. Guards
// against writing "temporary display entity" overwrite bugs to the store.
const worldEntityIdBase = (uint64(1) << 52) + 0xF0*(uint64(1)<<40)

func isWorldEntityId(id uint64) bool { return id >= worldEntityIdBase }

// ownCharacterIdBase/ownCharacterIdBlockSize bound the local player's own
// entity id; pets/mounts/summons sit in separate blocks above this range.
const ownCharacterIdBase = uint64(1) << 52
const ownCharacterIdBlockSize = uint64(1) << 40

func isOwnCharacterId(id uint64) bool {
	return id >= ownCharacterIdBase && id < ownCharacterIdBase+ownCharacterIdBlockSize
}

// setOwnerCharacter records the local player's id/name and publishes
// EventOwnerCharacter on change. Repeat calls with the same values are a
// no-op (dedupe). On an id change, the previous character's cached panel
// and worn set are cleared and an empty worn set is published so a client
// does not keep showing gear that belongs to the old character.
func (t *eventPublisher) setOwnerCharacter(id uint64, name string) {
	t.Lock()
	if t.ownerId == id && t.ownerName == name {
		t.Unlock()
		return
	}
	idChanged := t.ownerId != id
	if idChanged {
		t.ownerItems = nil // a different character: its items are gone
		t.lastOwnerPanel = nil
		t.lastOwnerStatsAt = 0
		t.lastOwnerEquip = nil
	}
	t.ownerId = id
	t.ownerName = name
	t.Unlock()

	t.publish(&event.EventOwnerCharacter{
		EventBase: event.EventBase{
			EventId: event.EventIdOwnerCharacter,
			At:      time.Now().Unix(),
			Id:      strconv.FormatUint(id, 10),
		},
		Name: name,
	})

	if idChanged {
		t.publishOwnerEquipment(time.Now().Unix())
	}
}

// shouldStoreSnapshot filters entities that must never enter the item store:
// summons/marionettes, Fynni pets, event/mount/doll entities (race >=
// 800000), unnamed entities, zero-id entities, and world (non-owned) entities.
func shouldStoreSnapshot(snap *packet.EntitySnapshot) bool {
	if snap.Id == 0 { // head-shape drift leaves Id unset; reject to avoid entity_id=0 clobbering
		return false
	}
	if isSummonRace(snap.RaceId) {
		return false
	}
	if snap.RaceId >= 33000 && snap.RaceId < 34000 {
		return false
	}
	if snap.RaceId >= 800000 {
		return false
	}
	if snap.Name == "" {
		return false
	}
	return !isWorldEntityId(snap.Id)
}

func (t *eventPublisher) handleEntityAppear(p *packet.GamePacket) {
	entity, err := packet.ParseEntityAppearPacket(p.Msg)
	if err != nil {
		logger.Println("ParseEntityAppearPacket failed:", err)
		return
	}
	if entity == nil {
		return
	}
	t.applyEntityAppear(entity, p.At)
}

// applyEntityAppear caches one appeared entity and publishes its appear,
// condition and equipment events. Shared by single and multi appear packets.
func (t *eventPublisher) applyEntityAppear(entity *packet.EntityInfo, at time.Time) {
	// Detect boss monsters by race id (more reliable than BGM): log on
	// appearance and track the entity id.
	if boss, ok := bossRaces[entity.RaceId]; ok {
		t.Lock()
		t.bossEntities[entity.Id] = boss
		t.Unlock()
		logger.Printf("boss appear: %s (race=%d id=%d)", boss, entity.RaceId, entity.Id)
	}

	if len(entity.Name) <= 0 || entity.Name[0] == '_' {
		return
	}

	// Collect events under lock, publish after unlock to avoid deadlock.
	var events []event.IEvent

	t.Lock()
	t.forgetEntitiesLocked(t.entityCache.add(entity, at))

	events = append(events, toEventEntityAppear(at.Unix(), entity))

	for _, v := range entity.CharacterConditionMap {
		if !t.entityCache.addOrUpdateCondition(entity.Id, v) {
			continue
		}
		attackerId := ""
		if v.AttackerId != 0 {
			attackerId = strconv.FormatUint(v.AttackerId, 10)
		}
		events = append(events, &event.EventCharacterConditionEnable{
			EventBase: event.EventBase{
				EventId: event.EventIdCharacterConditionEnable,
				At:      at.Unix(),
				Id:      strconv.FormatUint(entity.Id, 10),
			},
			CCId:       v.CCId,
			DisableAt:  t.clock.toLocalSec(v.DisableAtMs),
			ClockGen:   t.clockGen,
			AttackerId: attackerId,
			Params:     v.Params,
		})
	}

	for _, v := range entity.EquipItemMap {
		if !t.entityCache.addOrUpdateEquipItem(entity.Id, v) {
			continue
		}
		events = append(events, toEventEquipItem(at.Unix(), entity.Id, v))
	}

	for _, pocketType := range t.entityCache.allEquipItemPockets(entity.Id) {
		if entity.EquipItemMap[pocketType] != nil {
			continue
		}
		t.entityCache.unequipItem(entity.Id, pocketType)
		events = append(events, &event.EventEntityUnequipItem{
			EventBase: event.EventBase{
				EventId: event.EventIdEntityUnequipItem,
				At:      at.Unix(),
				Id:      strconv.FormatUint(entity.Id, 10),
			},
			PocketType: pocketType,
		})
	}
	t.Unlock()

	for _, e := range events {
		t.publish(e)
	}
}

func (t *eventPublisher) handleEntityDisappear(p *packet.GamePacket) {
	if len(p.Msg) < 1 || p.Msg[0].Type() != packet.MessageElemTypeLong {
		logger.Println("EntityDisappear: invalid packet")
		return
	}

	id := p.Msg[0].Data().(uint64)

	t.Lock()
	if boss, ok := t.bossEntities[id]; ok {
		delete(t.bossEntities, id)
		logger.Printf("boss gone: %s (id=%d)", boss, id)
	}
	t.Unlock()

	t.Lock()
	t.entityCache.disappear(id, p.At)
	t.Unlock()

	t.publish(&event.EventEntityDisappear{
		EventBase: event.EventBase{
			EventId: event.EventIdEntityDisappear,
			At:      p.At.Unix(),
			Id:      strconv.FormatUint(id, 10),
		},
	})
}

func (t *eventPublisher) handleCreatureBodyUpdate(p *packet.GamePacket) {
	if len(p.Msg) < 1 || p.Msg[0].Type() != packet.MessageElemTypeBin {
		logger.Println("CreatureBodyUpdate: invalid packet")
		return
	}

	b := p.Msg[0].Data().([]byte)
	if len(b) < 16 {
		logger.Printf("CreatureBodyUpdate: body data too short, got %d bytes", len(b))
		return
	}

	height := math.Float32frombits(le.Uint32(b[0:]))
	weight := math.Float32frombits(le.Uint32(b[4:]))
	upper := math.Float32frombits(le.Uint32(b[8:]))
	lower := math.Float32frombits(le.Uint32(b[12:]))

	t.Lock()
	t.entityCache.updateBody(p.Id, height, weight, upper, lower)
	t.Unlock()

	t.publish(&event.EventEntityUpdateBody{
		EventBase: event.EventBase{
			EventId: event.EventIdEntityUpdateBody,
			At:      p.At.Unix(),
			Id:      strconv.FormatUint(p.Id, 10),
		},
		Height: height,
		Weight: weight,
		Upper:  upper,
		Lower:  lower,
	})
}

// forgetEntitiesLocked drops per-entity state for ids the entity cache
// evicted; the owner is kept. Caller holds the lock.
func (t *eventPublisher) forgetEntitiesLocked(ids []uint64) {
	for _, id := range ids {
		if id == t.ownerId {
			continue
		}
		delete(t.statTables, id)
		delete(t.maxLifeSeen, id)
		delete(t.lifeSeen, id)
		delete(t.downedEntities, id)
		delete(t.deadPlayers, id)
		delete(t.invincible, id)
		delete(t.bossEntities, id)
		delete(t.bardsongBuffs, id)
	}
}

func (t *eventPublisher) handleEntitiesAppear(p *packet.GamePacket) {
	entities, err := packet.ParseEntitiesAppearPacket(p)
	if err != nil {
		logger.Println("ParseEntitiesAppearPacket failed:", err)
		return
	}

	for _, entity := range entities {
		t.applyEntityAppear(entity, p.At)
	}
}

func (t *eventPublisher) handleEntitiesDisappear(p *packet.GamePacket) {
	if len(p.Msg) < 1 || p.Msg[0].Type() != packet.MessageElemTypeShort {
		logger.Println("EntitiesDisappear: invalid packet")
		return
	}

	count := int(p.Msg[0].Data().(uint16))
	msg := p.Msg[1:]

	now := p.At.Unix()
	for i := 0; i < count; i++ {
		// Each entry: ttype (short), id (long), optional unk1 when ttype == 16
		if len(msg) < 2 ||
			msg[0].Type() != packet.MessageElemTypeShort ||
			msg[1].Type() != packet.MessageElemTypeLong {

			logger.Println("EntitiesDisappear: invalid packet")
			break
		}

		ttype := msg[0].Data().(uint16)
		id := msg[1].Data().(uint64)

		t.Lock()
		delete(t.bossEntities, id)
		t.entityCache.disappear(id, p.At)
		t.Unlock()

		t.publish(&event.EventEntityDisappear{
			EventBase: event.EventBase{
				EventId: event.EventIdEntityDisappear,
				At:      now,
				Id:      strconv.FormatUint(id, 10),
			},
		})

		msg = msg[2:]
		if ttype == 16 && len(msg) >= 1 {
			msg = msg[1:]
		}
	}
}

func (t *eventPublisher) handleEquipmentChanged(p *packet.GamePacket) {
	if len(p.Msg) < 1 || p.Msg[0].Type() != packet.MessageElemTypeBin {
		logger.Printf("EquipmentChanged: invalid packet op=%s", p.Op)
		return
	}

	b := p.Msg[0].Data().([]byte)
	info, err := packet.EntityItemReader(b)
	if err != nil {
		logger.Println("EntityItemReader failed:", err)
		return
	}

	t.Lock()
	changed := t.entityCache.addOrUpdateEquipItem(p.Id, info)
	t.Unlock()

	if !changed {
		return
	}

	t.publish(toEventEquipItem(p.At.Unix(), p.Id, info))
}

func (t *eventPublisher) handleUnequipment(p *packet.GamePacket) {
	if len(p.Msg) < 1 || p.Msg[0].Type() != packet.MessageElemTypeInt {
		return
	}

	pocketType := p.Msg[0].Data().(uint32)

	t.Lock()
	has := t.entityCache.hasEquipItem(p.Id, pocketType)
	if has {
		t.entityCache.unequipItem(p.Id, pocketType)
	}
	t.Unlock()

	if !has {
		return
	}

	t.publish(&event.EventEntityUnequipItem{
		EventBase: event.EventBase{
			EventId: event.EventIdEntityUnequipItem,
			At:      p.At.Unix(),
			Id:      strconv.FormatUint(p.Id, 10),
		},
		PocketType: pocketType,
	})
}

func (t *eventPublisher) handleSetFinisher(p *packet.GamePacket) {
	if len(p.Msg) < 1 || p.Msg[0].Type() != packet.MessageElemTypeLong {
		logger.Println("SetFinisher: invalid packet")
		return
	}

	attackerId := p.Msg[0].Data().(uint64)
	attackerIdStr := ""
	if attackerId != 0 {
		attackerIdStr = strconv.FormatUint(attackerId, 10)
	}

	t.publish(&event.EventFinish{
		EventBase: event.EventBase{
			EventId: event.EventIdFinish,
			At:      p.At.Unix(),
			Id:      strconv.FormatUint(p.Id, 10),
		},
		AttackerId: attackerIdStr,
	})
}

func (t *eventPublisher) handleCombatAction(p *packet.GamePacket) {
	pack, err := packet.ParseCombatActionPackPacket(p)
	if err != nil {
		logger.Println("ParseCombatActionPackPacket failed:", err)
		return
	}

	attackerId := uint64(0)
	attackSkillId := uint16(0)

	// Find the attacker sub-packet. We currently assume at most one
	// attacker per combat action pack.
	for _, v := range pack.SubPackets {
		if v.Hit == nil {
			attackerId = v.EntityId
			attackSkillId = v.SkillId
			break
		}
	}

	// 0x7926 carries the skill even when the attacker's sub-packet deals no
	// damage; that is the only broadcast source for buff and utility skills.
	//
	// The server can send one cast as two packs 0-3ms apart (間奏展擊 59165,
	// capture 2026-08-19_13-42-20; flags differ between the pair, so time is
	// the only reliable key). 50ms sits far under real repeats — the fastest
	// observed distinct swings are 88ms apart, and players are animation-locked.
	// Suppress only the skill-use EVENT on a double-send. attackSkillId must
	// survive untouched: the damage loop below stamps it onto every hit, and
	// zeroing it filed the second pack's damage under skill 0.
	dupSkillUse := false
	if attackSkillId != 0 {
		t.Lock()
		dupSkillUse = attackerId == t.lastSkillUseBy && attackSkillId == t.lastSkillUseId &&
			p.At.Sub(t.lastSkillUseAt) < 50*time.Millisecond
		if !dupSkillUse {
			t.lastSkillUseBy, t.lastSkillUseId, t.lastSkillUseAt = attackerId, attackSkillId, p.At
		}
		t.Unlock()
	}
	if attackSkillId != 0 && !dupSkillUse {
		t.publish(&event.EventSkillUse{
			EventBase: event.EventBase{
				EventId: event.EventIdSkillUse,
				At:      p.At.Unix(),
				Id:      strconv.FormatUint(attackerId, 10),
			},
			SkillId: attackSkillId,
		})
	}

	for _, v := range pack.SubPackets {
		if v.Hit == nil {
			continue
		}
		// Defender-side sub-packet carries the damage.
		targetId := v.EntityId
		damage := v.Hit.Damage
		isCritical := v.Hit.Options&0x1 != 0

		t.publish(&event.EventDamage{
			EventBase: event.EventBase{
				EventId: event.EventIdDamage,
				At:      p.At.Unix(),
				Id:      strconv.FormatUint(attackerId, 10),
			},
			TargetId:   strconv.FormatUint(targetId, 10),
			SkillId:    attackSkillId,
			Damage:     damage,
			IsCritical: isCritical,
			IsFinish:   v.Hit.Options&packet.CombatActionHitOptionsFinishingHit != 0,
		})
	}
}

func (t *eventPublisher) handleEffectDelayed(p *packet.GamePacket) {
	// Effect delayed: Chain Blade Blast damage uses this op.
	targetId := p.Id

	if len(p.Msg) < 2 ||
		p.Msg[0].Type() != packet.MessageElemTypeInt ||
		p.Msg[1].Type() != packet.MessageElemTypeInt {
		logger.Println("EffectDelayed: invalid packet")
		return
	}

	ttype := p.Msg[1].Data().(uint32)
	if ttype != 318 && ttype != 319 {
		// Not 星塵 (Stardust)-family delayed damage (Blast 58100 / Flare
		// 58101 / combo 58009). The discriminator moves with game patches
		// (317 -> 318 in 2026-06, 318 -> 319 expected 2026-08-20); older
		// values stay accepted so replaying old captures keeps working.
		return
	}

	if len(p.Msg) < 7 ||
		p.Msg[2].Type() != packet.MessageElemTypeInt ||
		p.Msg[5].Type() != packet.MessageElemTypeLong ||
		p.Msg[6].Type() != packet.MessageElemTypeShort {
		logger.Printf("EffectDelayed: invalid packet op=%s id=%x", p.Op, p.Id)
		return
	}

	damage := p.Msg[2].Data().(uint32)
	attackerId := p.Msg[5].Data().(uint64)
	attackSkillId := p.Msg[6].Data().(uint16)

	t.publish(&event.EventDamage{
		EventBase: event.EventBase{
			EventId: event.EventIdDamage,
			At:      p.At.Unix(),
			Id:      strconv.FormatUint(attackerId, 10),
		},
		TargetId:  strconv.FormatUint(targetId, 10),
		SkillId:   attackSkillId,
		Damage:    float32(damage),
		IsDelayed: true,
	})
}

// observeClockLocked feeds a condition's cast start into the server clock
// estimate and logs when it moves. Caller holds the lock; the returned shift
// event (nil when the estimate did not move) is for the caller to publish after unlocking.
func (t *eventPublisher) observeClockLocked(at time.Time, ccId uint32, params map[string]string) event.IEvent {
	start, song, ok := sampleFromParams(ccId, params)
	if !ok {
		return nil
	}
	old, had := t.clock.offsetMs()
	var changed bool
	if song {
		changed = t.clock.observeSong(at.UnixMilli(), start)
	} else {
		changed = t.clock.observe(at.UnixMilli(), start)
	}
	if !changed {
		return nil
	}
	now, _ := t.clock.offsetMs()
	t.clockGen++
	if had {
		logger.Printf("server clock offset %d -> %d ms", old, now)
	} else {
		logger.Printf("server clock offset -> %d ms", now)
	}
	return &event.EventClockShift{
		EventBase: event.EventBase{EventId: event.EventIdClockShift, At: at.Unix()},
		ShiftSec:  float64(old-now) / 1000,
		Gen:       t.clockGen,
	}
}

func (t *eventPublisher) handleConditionUpdate(p *packet.GamePacket) {
	cond, err := packet.ParseCharacterConditionPacket(p)
	if err != nil {
		logger.Println("ParseCharacterConditionPacket failed:", err)
		return
	}

	t.Lock()
	// Only a fresh cast gives a usable sample; updates of an active buff keep
	// its original MCAGT and would read as a stale clock.
	fresh := false
	if e := t.entityCache[cond.Id]; e != nil && cond.IsEnable {
		prev := e.characterConditionMap[cond.CCId]
		fresh = prev == nil || prev.Params["MCAGT"] != cond.Params["MCAGT"]
	}
	t.entityCache.addCondition(cond)
	var disableAt float64
	var shift event.IEvent
	var clockGen int
	if cond.IsEnable {
		if fresh {
			shift = t.observeClockLocked(p.At, cond.CCId, cond.Params)
		}
		disableAt = t.clock.toLocalSec(cond.DisableAtMs)
		clockGen = t.clockGen
	}
	t.Unlock()

	if shift != nil {
		t.publish(shift)
	}

	if !cond.IsEnable {
		t.publish(&event.EventCharacterConditionDisable{
			EventBase: event.EventBase{
				EventId: event.EventIdCharacterConditionDisable,
				At:      p.At.Unix(),
				Id:      strconv.FormatUint(cond.Id, 10),
			},
			CCId: cond.CCId,
		})
		return
	}

	attackerId := ""
	if cond.AttackerId != 0 {
		attackerId = strconv.FormatUint(cond.AttackerId, 10)
	}

	t.publish(&event.EventCharacterConditionEnable{
		EventBase: event.EventBase{
			EventId: event.EventIdCharacterConditionEnable,
			At:      p.At.Unix(),
			Id:      strconv.FormatUint(cond.Id, 10),
		},
		CCId:       cond.CCId,
		DisableAt:  disableAt,
		ClockGen:   clockGen,
		AttackerId: attackerId,
		Params:     cond.Params,
	})
}

func (t *eventPublisher) handleChat(p *packet.GamePacket) {
	// Chat packet: channel (byte), from (string), message (string)
	if len(p.Msg) < 3 ||
		p.Msg[0].Type() != packet.MessageElemTypeByte ||
		p.Msg[1].Type() != packet.MessageElemTypeString ||
		p.Msg[2].Type() != packet.MessageElemTypeString {
		return
	}

	t.publish(&event.EventChat{
		EventBase: event.EventBase{
			EventId: event.EventIdChat,
			At:      p.At.Unix(),
			Id:      strconv.FormatUint(p.Id, 10),
		},
		Channel: p.Msg[0].Data().(uint8),
		From:    p.Msg[1].Data().(string),
		Message: p.Msg[2].Data().(string),
	})
}

// noticeCategoryBuff is element 0 of a 0x526D notice addressed to the local
// player (buff gained/lost). The other categories seen are 2 (server-wide
// broadcast) and 3 (world event).
const noticeCategoryBuff uint8 = 4

func (t *eventPublisher) handleNotice(p *packet.GamePacket) {
	// (Byte category, String message), sometimes with trailing Ints that
	// vary by category — accept any tail rather than pinning a length.
	if len(p.Msg) < 2 ||
		p.Msg[0].Type() != packet.MessageElemTypeByte ||
		p.Msg[1].Type() != packet.MessageElemTypeString {
		return
	}

	category := p.Msg[0].Data().(uint8)
	text := p.Msg[1].Data().(string)
	t.publish(&event.EventNotice{
		EventBase: event.EventBase{
			EventId: event.EventIdNotice,
			At:      p.At.Unix(),
			Id:      strconv.FormatUint(p.Id, 10),
		},
		Category: category,
		Message:  text,
	})

	// Only the self/buff category carries song announcements; 2 and 3 are
	// server-wide and world-event broadcasts.
	if category != noticeCategoryBuff {
		return
	}

	// A bard-song announcement is private, so its subject is always the
	// local player — never the packet's Id.
	if n, ok := packet.ParseBardsongNotice(text); ok {
		t.Lock()
		ownerId := t.ownerId
		t.Unlock()

		t.publish(&event.EventBardsong{
			EventBase: event.EventBase{
				EventId: event.EventIdBardsong,
				At:      p.At.Unix(),
				Id:      strconv.FormatUint(ownerId, 10),
			},
			Performer: n.Performer,
			Song:      n.Song,
			Bonuses:   n.Bonuses,
			IsEnd:     n.IsEnd,
		})
		if n.IsEnd {
			t.endOwnerBardsong(p.At.Unix())
		}
		return
	}
}

// handleDeath publishes a player's death or revive; a repeat of the
// current state, and any non-player, stays silent.
func (t *eventPublisher) handleDeath(p *packet.GamePacket, dead bool) {
	at := p.At.Unix()
	t.Lock()
	_, wasDead := t.deadPlayers[p.Id]
	e, ok := t.entityCache[p.Id]
	changed := wasDead != dead && (!dead || ok && playerRaceSet[e.RaceId])
	if changed {
		if dead {
			t.deadPlayers[p.Id] = at
		} else {
			delete(t.deadPlayers, p.Id)
		}
	}
	t.Unlock()
	if changed {
		t.publish(&event.EventEntityDeath{
			EventBase: event.EventBase{
				EventId: event.EventIdEntityDeath,
				At:      at,
				Id:      strconv.FormatUint(p.Id, 10),
			},
			Dead: dead,
		})
	}
}

// handleInvincible turns 0x7533 (long entityId, byte on) into the synthetic
// condition 91000 when the flag changes; the packet comes from the region,
// so the target is in the body.
func (t *eventPublisher) handleInvincible(p *packet.GamePacket) {
	if len(p.Msg) < 2 || p.Msg[0].Type() != packet.MessageElemTypeLong || p.Msg[1].Type() != packet.MessageElemTypeByte {
		return
	}
	id := p.Msg[0].Data().(uint64)
	on := p.Msg[1].Data().(uint8) != 0
	at := p.At.Unix()
	t.Lock()
	_, was := t.invincible[id]
	if on && !was {
		t.invincible[id] = at
	} else if !on && was {
		delete(t.invincible, id)
	}
	t.Unlock()
	if on != was {
		t.publish(bossInvincibleCondEvent(id, at, on))
	}
}

func bossInvincibleCondEvent(id uint64, at int64, on bool) event.IEvent {
	base := event.EventBase{At: at, Id: strconv.FormatUint(id, 10)}
	if !on {
		base.EventId = event.EventIdCharacterConditionDisable
		return &event.EventCharacterConditionDisable{EventBase: base, CCId: bossInvincibleCCId}
	}
	base.EventId = event.EventIdCharacterConditionEnable
	return &event.EventCharacterConditionEnable{EventBase: base, CCId: bossInvincibleCCId, Params: map[string]string{}}
}

// lifeState tracks a boss's latest life against what was last published.
type lifeState struct {
	last, sent float64
	sentAt     int64
	lastAt     int64
	hasSent    bool
}

func (t *eventPublisher) handleStatUpdate(p *packet.GamePacket) {
	// Public updates (0x7532) carry typed (statId, float) pairs; surface
	// max life so the frontend can label bosses, but only when it is first
	// seen or changes — the raw stream repeats it thousands of times.
	if p.Op == packet.OpcodeStatUpdatePublic {
		st := packet.ParseStatUpdatePublic(p)
		// A tracked boss crossing zero life publishes a one-shot down
		// event — the kill signal the run summary trusts.
		if life, ok := st[packet.StatIdLife]; ok && life <= 0 {
			t.Lock()
			_, isBoss := t.bossEntities[p.Id]
			downed := t.downedEntities[p.Id]
			if isBoss && !downed {
				t.downedEntities[p.Id] = true
			}
			t.Unlock()
			if isBoss && !downed {
				t.publish(&event.EventEntityDown{
					EventBase: event.EventBase{
						EventId: event.EventIdEntityDown,
						At:      p.At.Unix(),
						Id:      strconv.FormatUint(p.Id, 10),
					},
				})
			}
		}
		if life, ok := st[packet.StatIdLife]; ok && life > 0 {
			t.handleDeath(p, false)
		}
		if life, ok := st[packet.StatIdLife]; ok {
			at := p.At.Unix()
			t.Lock()
			_, isBoss := t.bossEntities[p.Id]
			send := false
			if isBoss {
				ls := t.lifeSeen[p.Id]
				ls.last, ls.lastAt = life, at
				// A kill (life <= 0) is flushed at once so it is never throttled away.
				kill := life <= 0 && ls.sent > 0
				if !ls.hasSent || kill || (ls.last != ls.sent && at-ls.sentAt >= 1) {
					ls.sent, ls.sentAt, ls.hasSent = life, at, true
					send = true
				}
				t.lifeSeen[p.Id] = ls
			}
			t.Unlock()
			if send {
				t.publish(&event.EventEntityLife{
					EventBase: event.EventBase{
						EventId: event.EventIdEntityLife,
						At:      at,
						Id:      strconv.FormatUint(p.Id, 10),
					},
					Life: life,
				})
			}
		}
		if max, ok := st[packet.StatIdLifeMax]; ok {
			t.Lock()
			changed := t.maxLifeSeen[p.Id] != max
			if changed {
				t.maxLifeSeen[p.Id] = max
			}
			t.Unlock()
			if changed {
				t.publish(&event.EventMaxLife{
					EventBase: event.EventBase{
						EventId: event.EventIdMaxLife,
						At:      p.At.Unix(),
						Id:      strconv.FormatUint(p.Id, 10),
					},
					MaxLife: max,
				})
			}
		}
	}

	// Stat update: forward the raw blob as-is; the frontend decides
	// which fields to interpret. Supports the first binary message
	// element if present.
	var data []byte
	for _, m := range p.Msg {
		if m.Type() == packet.MessageElemTypeBin {
			data = m.Data().([]byte)
			break
		}
	}
	if data == nil {
		return
	}

	t.publish(&event.EventStatUpdate{
		EventBase: event.EventBase{
			EventId: event.EventIdStatUpdate,
			At:      p.At.Unix(),
			Id:      strconv.FormatUint(p.Id, 10),
		},
		Data: append([]byte(nil), data...),
	})
}

// _dynRegionHead / _dynRegionEntry are the 0xA9A0 layout: a fixed head of
// (long eid, int from, int to, int x, int y, int ?, int count) then count
// entries of (int id, string name, int flags, int baseId, string baseName,
// int lighting, byte, string variation, byte).
const (
	_dynRegionHead  = 7
	_dynRegionEntry = 9
)

// handleDynamicRegionList records the dynamic-region table 0xA9A0 sends
// when a dungeon instance is created. Every copy carries the full table, so it
// replaces what was stored. Verified: capture 1785312528, 喀輪巴斯 = 35012
// NTD_dungeon (小怪房) + 35031 TR_main_field_01 (王房).
func (t *eventPublisher) handleDynamicRegionList(p *packet.GamePacket) {
	if len(p.Msg) < _dynRegionHead || p.Msg[6].Type() != packet.MessageElemTypeInt {
		return
	}
	count := int(p.Msg[6].Data().(uint32))
	if len(p.Msg) < _dynRegionHead+count*_dynRegionEntry {
		return
	}

	m := make(map[uint32]dynRegion, count)
	for i := range count {
		e := p.Msg[_dynRegionHead+i*_dynRegionEntry:]
		if e[0].Type() != packet.MessageElemTypeInt ||
			e[3].Type() != packet.MessageElemTypeInt ||
			e[4].Type() != packet.MessageElemTypeString {
			return
		}
		m[e[0].Data().(uint32)] = dynRegion{
			baseId:   e[3].Data().(uint32),
			baseName: e[4].Data().(string),
		}
	}

	t.Lock()
	t.dynRegions = m
	t.Unlock()
}

// handleStatTable keeps a per-entity stat table. 0x5209 seeds it (the only
// packet carrying the base values); 0x7530 / 0x7532 overlay the deltas that
// follow, since a delta never resends an unchanged stat.
func (t *eventPublisher) handleStatTable(p *packet.GamePacket) {
	var (
		id uint64
		st packet.StatTable
	)
	if p.Op == packet.OpcodeChannelCharacterInfoR {
		if len(p.Msg) < 2 || p.Msg[1].Type() != packet.MessageElemTypeLong {
			return
		}
		id, st = p.Msg[1].Data().(uint64), packet.ParseStatSnapshot(p.Msg)
	} else {
		id, st = p.Id, packet.ParseStatUpdate(p.Msg)
	}
	if id == 0 || len(st) == 0 {
		return
	}

	t.Lock()
	if t.statTables == nil {
		t.statTables = make(map[uint64]packet.StatTable)
	}
	cur, ok := t.statTables[id]
	if !ok {
		cur = make(packet.StatTable, len(st))
		t.statTables[id] = cur
	}
	cur.Merge(st)
	var stats *event.EventOwnerStats
	if id == t.ownerId {
		stats = t.ownerStatsIfChangedLocked(p.At.Unix())
	}
	t.Unlock()
	if stats != nil {
		t.publish(stats)
	}
}

// panelOf returns the character-window values derived from an entity's stat
// table, or false when no stats have been seen for it. Nothing consumes it
// yet — it is the accessor the UI will read once a stat panel exists.
func (t *eventPublisher) panelOf(id uint64) (packet.Panel, bool) {
	t.Lock()
	defer t.Unlock()
	st, ok := t.statTables[id]
	if !ok {
		return packet.Panel{}, false
	}
	return st.Panel(), true
}

// mapChangeLine composes the map-change log line. base and mission are the
// already-rendered ", base=…" / " mission=…" fragments, empty when unknown.
func mapChangeLine(name string, region uint32, base, mission, prevName string) string {
	s := fmt.Sprintf("map change: %s (region=%d%s)%s", name, region, base, mission)
	if prevName != "" {
		s += " from " + prevName
	}
	return s
}

// regionBaseSuffix renders the static region a dynamic region was cloned from,
// e.g. ", base=TR_main_field_01(4016)". Empty when 0xA9A0 didn't list it.
func (t *eventPublisher) regionBaseSuffix(region uint32) string {
	t.Lock()
	b, ok := t.dynRegions[region]
	t.Unlock()
	if !ok {
		return ""
	}
	return fmt.Sprintf(", base=%s(%d)", b.baseName, b.baseId)
}

// regionBaseName returns the dynamic region's base name (the dungeon's
// difficulty tier, e.g. "NRD_3S"), or "" when 0xA9A0 didn't list it.
func (t *eventPublisher) regionBaseName(region uint32) string {
	t.Lock()
	b, ok := t.dynRegions[region]
	t.Unlock()
	if !ok {
		return ""
	}
	return b.baseName
}

// handleSetLocation logs a map change. 26009 carries (byte, region, x, y)
// for the owner — sent on warp (moongate etc.) and on channel-in. Verified:
// capture 1783536131, moongate ceoisland→tirchonaill = region 35011.
func (t *eventPublisher) handleSetLocation(p *packet.GamePacket) {
	if len(p.Msg) < 4 ||
		p.Msg[1].Type() != packet.MessageElemTypeInt ||
		p.Msg[2].Type() != packet.MessageElemTypeInt ||
		p.Msg[3].Type() != packet.MessageElemTypeInt {
		return
	}
	region := p.Msg[1].Data().(uint32)

	t.Lock()
	changed := region != t.lastRegion
	prevName := t.lastRegionName
	t.lastRegion = region
	missionID := t.lastMissionID
	missionCode := t.lastMission
	var owner string
	if e, ok := t.entityCache[p.Id]; ok {
		owner = e.Name
	}
	t.Unlock()

	if owner != "" && isOwnCharacterId(p.Id) {
		t.setOwnerCharacter(p.Id, owner)
	}

	if !changed {
		return
	}

	// Resolve the new name now and remember it: resolving the PREVIOUS
	// region later would be wrong for dynamic instances (their name depends
	// on lastMissionID, which the next dungeon already overwrote).
	name := t.regionName(region)
	t.Lock()
	t.lastRegionName = name
	// Left the dungeon (back to a static region): drop the stale mission so
	// it can't leak into the next region's log or name resolution.
	if region < 35000 {
		t.lastMission = ""
		t.lastMissionID = 0
		t.lastMissionName = ""
		// Dynamic ids are recycled, so a table whose dungeon we already left
		// must not annotate the next instance if its 0xA9A0 goes missing.
		t.dynRegions = nil
	}
	t.Unlock()

	// Battle boundary: a whitelisted run is one segment, anything else cuts.
	_, whitelisted := dungeonCodes[missionID]
	whitelisted = whitelisted && region >= 35000
	if !(whitelisted && t.inWhitelistRun.Load()) {
		t.markBattleBoundary(p.At.Unix(), whitelisted)
	}
	t.inWhitelistRun.Store(whitelisted)

	// mission kind: only meaningful inside a dungeon (dynamic region).
	mission := ""
	if region >= 35000 {
		switch {
		case missionCode != "" && missionID != 0:
			mission = fmt.Sprintf(" mission=%s#%d", missionCode, missionID)
		case missionCode != "":
			mission = fmt.Sprintf(" mission=%s", missionCode)
		case missionID != 0:
			mission = fmt.Sprintf(" mission=#%d", missionID)
		}
	}

	logger.Print(mapChangeLine(name, region, t.regionBaseSuffix(region), mission, prevName))

	// Whitelisted dungeon -> tee to an event file; leaving (incl. warping
	// elsewhere) -> close it. Sub-map switches within a dungeon (dynamic->
	// dynamic, same mission, e.g. 布里萊赫/Brileith 35011->35013) count as
	// the same run and do not rotate the file.
	recordBattles := !t.readOnly.Load() || t.importBattles.Load()
	if code, ok := dungeonCodes[missionID]; ok && region >= 35000 && recordBattles {
		if t.dgnLog.IsOpen() {
			return
		}
		if owner == "" {
			owner = "unknown"
		}
		// Teammates already appeared before entry, so seed the file with an
		// entityCache snapshot or damage events won't map to player names.
		tier := t.regionBaseName(region)
		t.Lock()
		r := t.r
		t.Unlock()
		pcapng := ""
		if r != nil {
			pcapng = r.SourceName()
		}
		if err := t.dgnLog.Open(code, tier, owner, p.At, missionID, pcapng, t.dungeonClient(), t.snapshotEvents(true)); err != nil {
			logger.Println("dungeon-log open failed:", err)
		}
	} else {
		t.dgnLog.Close()
	}
}

// missionNames: dungeon mission code -> display name (derived by matching
// minimap jpg names against MinimapInfo, e.g. minimap_2024_mrd_* -> Mullias;
// extended over time).
var missionNames = map[string]string{
	"mrd": "穆利亞斯",
}

// handleMissionState records the enter_<code> mission code; the dynamic
// region 26009 that follows uses it to name the dungeon.
func (t *eventPublisher) handleMissionState(p *packet.GamePacket) {
	if len(p.Msg) < 3 || p.Msg[2].Type() != packet.MessageElemTypeString {
		return
	}
	s, _ := p.Msg[2].Data().(string)
	if code, ok := strings.CutPrefix(s, "enter_"); ok && code != "" {
		t.Lock()
		t.lastMission = code
		t.Unlock()
	}
}

// questKindDungeonMission is the 36000 quest-journal entry kind for dungeon
// missions (other kinds carry daily quests etc. whose ids are not mission ids).
const questKindDungeonMission = 7

// handleQuestInfo records the dungeon mission id + display name from a
// kind-7 quest-journal entry (36000), which precedes the dynamic-region
// 26009. This replaced 45004 as the mission-id source after the 2026-07-23
// game update dropped that packet.
func (t *eventPublisher) handleQuestInfo(p *packet.GamePacket) {
	if len(p.Msg) < 7 ||
		p.Msg[4].Type() != packet.MessageElemTypeByte ||
		p.Msg[5].Type() != packet.MessageElemTypeInt ||
		p.Msg[6].Type() != packet.MessageElemTypeString {
		return
	}
	if kind, _ := p.Msg[4].Data().(uint8); kind != questKindDungeonMission {
		return
	}
	id, _ := p.Msg[5].Data().(uint32)
	if id == 0 {
		return
	}
	name, _ := p.Msg[6].Data().(string)

	t.Lock()
	t.lastMissionID = id
	t.lastMissionName = name
	t.Unlock()
}

// handleMissionStart records the dungeon mission id (45004 arrives before
// the dynamic region's 26009).
func (t *eventPublisher) handleMissionStart(p *packet.GamePacket) {
	if len(p.Msg) < 1 || p.Msg[0].Type() != packet.MessageElemTypeInt {
		return
	}
	id, _ := p.Msg[0].Data().(uint32)
	t.Lock()
	t.lastMissionID = id
	t.Unlock()
}

// bossBGMNames: boss-fight BGM filename -> boss name (Race.xml EnglishName
// abbreviations: VT=Vertrag, BT=Bronntanas, LM=Midir of Leannan).
var bossBGMNames = map[string]string{
	"Boss_VT.mp3": "佩塔克",
	"Boss_BT.mp3": "布倫塔納斯",
	"Boss_LM.mp3": "雷楠的米勒",
}

// bossRaces: boss monster race id -> boss name (Race.xml, including
// difficulty/form variants). Currently the three 布里萊赫 (Brileith) bosses;
// other dungeons' bosses added over time.
var bossRaces = map[uint32]string{
	5211: "佩塔克", 5216: "佩塔克", 5217: "佩塔克", 5229: "佩塔克",
	5224: "古樹的佩塔克",
	7600: "佩塔克", 7601: "佩塔克",
	5225: "布倫塔納斯", 7602: "布倫塔納斯",
	5218: "雷楠的米勒", 7603: "雷楠的米勒",
	7615: "雷楠的米勒:悔恨",
	// 喀輪巴斯深淵 boss (tw168 race; 193369/193402/193432 are its NPC forms)
	193810: "佩洛姆",
	// 實戰課程-木頭人: the names grade defense/protection (mimicking those
	// bosses), not HP — all five share the same life pool.
	4856: "和浣熊一樣虛弱的木頭人",
	4857: "和泰赫圖殷之門一樣堅固的木頭人",
	4858: "和魅魔女王一樣堅固的木頭人",
	4859: "和伊魯夏一樣堅固的木頭人",
	4860: "和卡莉亞赫一樣堅固的木頭人",
}

// handleBGMPlay detects boss-fight start/end by BGM change: switching to
// Boss_*.mp3 = start, switching from Boss_* to another track = end.
func (t *eventPublisher) handleBGMPlay(p *packet.GamePacket) {
	if len(p.Msg) < 1 || p.Msg[0].Type() != packet.MessageElemTypeString {
		return
	}
	bgm, _ := p.Msg[0].Data().(string)
	t.Lock()
	prev := t.lastBGM
	t.lastBGM = bgm
	t.Unlock()
	if bgm == prev {
		return
	}
	if strings.HasPrefix(bgm, "Boss_") {
		name := bossBGMNames[bgm]
		if name == "" {
			name = bgm
		}
		logger.Printf("boss fight start: %s", name)
	} else if strings.HasPrefix(prev, "Boss_") {
		logger.Printf("boss fight end (bgm -> %s)", bgm)
	}
}

// regionName returns the map name; >=35000 is a dynamic dungeon instance
// (new id assigned each entry), not in the static table, so it is named from
// the most recent mission id / mission code.
func (t *eventPublisher) regionName(region uint32) string {
	if n, ok := regionNames[region]; ok {
		return n
	}
	if region >= 35000 {
		t.Lock()
		id, code, missionName := t.lastMissionID, t.lastMission, t.lastMissionName
		t.Unlock()
		if n, ok := dungeonNames[id]; ok {
			return fmt.Sprintf("副本:%s", n)
		}
		if missionName != "" {
			return fmt.Sprintf("副本:%s", missionName)
		}
		if code != "" {
			if n, ok := missionNames[code]; ok {
				return fmt.Sprintf("副本:%s", n)
			}
			return fmt.Sprintf("副本:%s", code)
		}
		return "副本(動態區域)"
	}
	return "未知地圖"
}

// skillCastKind selects the one 0x9093 variant that carries a skill id.
//
// The number is empirical, not documented: every kind on this opcode has its
// own element shape, and 806's is the only one that is (int, short, short)
// with a real skill id in the middle. It fires in the same millisecond the
// caster's charge condition clears and a few ms before any damage.
//
// Treat it as fragile. The sibling discriminator on OpcodeEffectDelayed
// changed 317 -> 318 in the 2026-06 update; when that happens here the feature
// goes quiet instead of failing. To re-derive it, dump 0x9093 grouped by first
// element and look for the kind whose middle short matches known skill ids.
const skillCastKind = 806

func (t *eventPublisher) handleSkillCast(p *packet.GamePacket) {
	if len(p.Msg) < 3 ||
		p.Msg[0].Type() != packet.MessageElemTypeInt ||
		p.Msg[1].Type() != packet.MessageElemTypeShort ||
		p.Msg[2].Type() != packet.MessageElemTypeShort {
		return
	}
	if p.Msg[0].Data().(uint32) != skillCastKind {
		return
	}

	t.publish(&event.EventSkillCast{
		EventBase: event.EventBase{
			EventId: event.EventIdSkillCast,
			At:      p.At.Unix(),
			Id:      strconv.FormatUint(p.Id, 10),
		},
		SkillId: p.Msg[1].Data().(uint16),
	})
}

// bardsongPulseKind is the 0x9093 variant a performer emits while singing:
// (int 21, byte sub, long targets...). Sub 7 lists who the song reached on
// this pulse, sub 0 is the performer stopping; sub 1 trails each pulse empty
// (capture 20260910_164818, 03:05:49).
const (
	bardsongPulseKind    = 21
	bardsongPulseSubHit  = 7
	bardsongPulseSubStop = 0
)

func (t *eventPublisher) handleBardsongPulse(p *packet.GamePacket) {
	if len(p.Msg) < 2 ||
		p.Msg[0].Type() != packet.MessageElemTypeInt ||
		p.Msg[1].Type() != packet.MessageElemTypeByte ||
		p.Msg[0].Data().(uint32) != bardsongPulseKind {
		return
	}
	sub := p.Msg[1].Data().(uint8)
	if sub != bardsongPulseSubHit && sub != bardsongPulseSubStop {
		return
	}
	targets := make([]string, 0, len(p.Msg)-2)
	for _, e := range p.Msg[2:] {
		if e.Type() != packet.MessageElemTypeLong {
			return
		}
		targets = append(targets, strconv.FormatUint(e.Data().(uint64), 10))
	}

	t.publish(&event.EventBardsongPulse{
		EventBase: event.EventBase{
			EventId: event.EventIdBardsongPulse,
			At:      p.At.Unix(),
			Id:      strconv.FormatUint(p.Id, 10),
		},
		Targets: targets,
		Stop:    sub == bardsongPulseSubStop,
	})
	t.applyBardsongPulse(p, targets, sub == bardsongPulseSubStop)
}

// Only the first element is read: 0x6984 has three tail variants and a
// fourth would silently drop the whole event if asserted on.
func (t *eventPublisher) handleSkillPrepareStart(p *packet.GamePacket) {
	if len(p.Msg) < 1 || p.Msg[0].Type() != packet.MessageElemTypeShort {
		return
	}
	skillId := p.Msg[0].Data().(uint16)

	t.Lock()
	t.preparingSkill = skillId
	ownerId := t.ownerId
	t.Unlock()

	// Self-only: never seen for anyone but the local player, so the event
	// is keyed by ownerId rather than the packet's own Id.
	t.publish(&event.EventSkillPrepareStart{
		EventBase: event.EventBase{
			EventId: event.EventIdSkillPrepareStart,
			At:      p.At.Unix(),
			Id:      strconv.FormatUint(ownerId, 10),
		},
		SkillId: skillId,
	})
}

// 0x698B carries no skillId, so it reuses the one 0x6984 remembered; nothing
// in flight (e.g. mid-channel capture attach) publishes nothing. Either way
// the remembered skill is cleared, so a repeat stop can't replay it.
func (t *eventPublisher) handleSkillStop(p *packet.GamePacket) {
	t.Lock()
	skillId := t.preparingSkill
	t.preparingSkill = 0
	ownerId := t.ownerId
	t.Unlock()

	if skillId == 0 {
		return
	}

	t.publish(&event.EventSkillStop{
		EventBase: event.EventBase{
			EventId: event.EventIdSkillStop,
			At:      p.At.Unix(),
			Id:      strconv.FormatUint(ownerId, 10),
		},
		SkillId: skillId,
	})
}

func (t *eventPublisher) handleChangeStance(p *packet.GamePacket) {
	// Stance change: either a bare byte or a byte followed by other
	// fields depending on direction (request vs response).
	var stance uint8
	for _, m := range p.Msg {
		if m.Type() == packet.MessageElemTypeByte {
			stance = m.Data().(uint8)
			break
		}
	}

	t.publish(&event.EventChangeStance{
		EventBase: event.EventBase{
			EventId: event.EventIdChangeStance,
			At:      p.At.Unix(),
			Id:      strconv.FormatUint(p.Id, 10),
		},
		Stance: stance,
	})
}

// playerRaceSet mirrors the frontend's pcRaceSet: the six player races.
var playerRaceSet = map[uint32]bool{
	8001: true, 8002: true, 9001: true, 9002: true, 10001: true, 10002: true,
}

// snapshotEvents rebuilds the entityCache into an event sequence (appear +
// condition + equip), shared by a new WS client's initial snapshot and the
// dungeon file's open-time seeding. playersOnly drops everything but player
// entities — the dungeon file's seed used to carry every town NPC seen since
// startup (1,600+ appears per file); entities that matter to the fight emit
// their own appear events once inside it.
func (t *eventPublisher) snapshotEvents(playersOnly bool) []event.IEvent {
	t.Lock()
	defer t.Unlock()
	initial := t.entityEventsLocked(playersOnly, true)
	return append(initial, t.leadEventsLocked(playersOnly)...)
}

// entityEventsLocked rebuilds the entityCache into appear + max life (+
// condition) + equip events. Caller holds the lock.
func (t *eventPublisher) entityEventsLocked(playersOnly, conditions bool) []event.IEvent {
	initial := []event.IEvent(nil)

	for _, entity := range t.entityCache {
		if playersOnly && !playerRaceSet[entity.RaceId] {
			continue
		}
		initial = append(initial, toEventEntityAppear(entity.appearAt, entity.EntityInfo))

		// Known max life rides along, or a late-attaching client would
		// never see it (live publishes only fire on change).
		if max, ok := t.maxLifeSeen[entity.Id]; ok {
			initial = append(initial, &event.EventMaxLife{
				EventBase: event.EventBase{
					EventId: event.EventIdMaxLife,
					At:      entity.appearAt,
					Id:      strconv.FormatUint(entity.Id, 10),
				},
				MaxLife: max,
			})
		}

		if ls, ok := t.lifeSeen[entity.Id]; ok {
			initial = append(initial, &event.EventEntityLife{
				EventBase: event.EventBase{
					EventId: event.EventIdEntityLife,
					At:      ls.lastAt,
					Id:      strconv.FormatUint(entity.Id, 10),
				},
				Life: ls.last,
			})
		}

		if at, ok := t.deadPlayers[entity.Id]; ok {
			initial = append(initial, &event.EventEntityDeath{
				EventBase: event.EventBase{
					EventId: event.EventIdEntityDeath,
					At:      at,
					Id:      strconv.FormatUint(entity.Id, 10),
				},
				Dead: true,
			})
		}

		if at, ok := t.invincible[entity.Id]; ok {
			initial = append(initial, bossInvincibleCondEvent(entity.Id, at, true))
		}

		for _, cond := range entity.characterConditionMap {
			if !conditions {
				break
			}
			attackerId := ""
			if cond.AttackerId != 0 {
				attackerId = strconv.FormatUint(cond.AttackerId, 10)
			}

			initial = append(initial, &event.EventCharacterConditionEnable{
				EventBase: event.EventBase{
					EventId: event.EventIdCharacterConditionEnable,
					At:      entity.appearAt,
					Id:      strconv.FormatUint(entity.Id, 10),
				},
				CCId:       cond.CCId,
				DisableAt:  t.clock.toLocalSec(cond.DisableAtMs),
				ClockGen:   t.clockGen,
				AttackerId: attackerId,
				Params:     cond.Params,
			})
		}

		if conditions {
			initial = append(initial, t.bardsongSnapshotEventsLocked(entity.Id, entity.appearAt)...)
		}

		for _, item := range entity.equipItemMap {
			initial = append(initial, toEventEquipItem(entity.appearAt, entity.Id, item))
		}
	}
	return initial
}

// leadEventsLocked is the owner / capture status / source part of a new
// client's snapshot. Caller holds the lock.
func (t *eventPublisher) leadEventsLocked(playersOnly bool) []event.IEvent {
	var initial []event.IEvent
	now := time.Now().Unix()

	if t.ownerName != "" {
		initial = append(initial, &event.EventOwnerCharacter{
			EventBase: event.EventBase{
				EventId: event.EventIdOwnerCharacter,
				At:      now,
				Id:      strconv.FormatUint(t.ownerId, 10),
			},
			Name: t.ownerName,
		})
	}
	if len(t.ownerItems) > 0 {
		initial = append(initial, t.ownerEquipmentEventLocked(now))
	}
	if ownerStats := t.ownerStatsLocked(now); ownerStats != nil {
		initial = append(initial, ownerStats)
	}

	// Seed a late-attaching client with the current capture status; live
	// publishes only fire on change (mirrors the maxLifeSeen ride-along above).
	if t.captureStatus != nil {
		initial = append(initial, t.captureStatus)
	}
	if src := t.sourceEvt.Load(); src != nil && !playersOnly {
		initial = append(initial, src)
	}
	return initial
}

// addClient registers a new WebSocket client and sends it a snapshot of
// the current entity cache so the UI can render without waiting for new
// packets. Safe to call from its own goroutine.
func (t *eventPublisher) addClient(ctx context.Context, ch chan<- []event.IEvent) uint32 {
	return t.addClientOpt(ctx, ch, false)
}

// addClientOpt is addClient; skipReadOnly drops batches while read-only.
func (t *eventPublisher) addClientOpt(ctx context.Context, ch chan<- []event.IEvent, skipReadOnly bool) uint32 {
	t.Lock()
	t.currentClientId++
	clientId := t.currentClientId
	t.Unlock()

	initial := t.snapshotEvents(false)

	if len(initial) > 0 {
		logger.Printf("send initial data: client=%d events=%d", clientId, len(initial))
		ch <- initial
	}

	t.Lock()
	t.clientMap[clientId] = &eventClient{
		ctx:          ctx,
		ch:           ch,
		skipReadOnly: skipReadOnly,
	}
	t.Unlock()

	return clientId
}

// addClientWithHistory registers a client after sending it the lead snapshot
// (plus entity state when history was truncated) and the event history, all
// under one lock so no live batch can slip between snapshot and registration.
// ch must have room for the whole backlog.
func (t *eventPublisher) addClientWithHistory(ctx context.Context, ch chan<- []event.IEvent, o historyOpts) {
	t.Lock()
	defer t.Unlock()
	t.currentClientId++
	clientId := t.currentClientId

	var backlog [][]event.IEvent
	if lead := t.leadEventsLocked(false); len(lead) > 0 {
		backlog = append(backlog, lead)
	}
	chunks := t.hist.chunks()
	if o.currentOnly {
		// Without earlier segments the entity state (with conditions) must come from the cache.
		chunks = t.hist.currentChunks()
		if ents := dedupeSnapshotConditions(t.entityEventsLocked(false, true), chunks, 0); len(ents) > 0 {
			backlog = append(backlog, ents)
		}
	} else if t.hist.truncated() {
		from := int64(0)
		if len(t.hist.segs) > 0 {
			from = t.hist.segs[0].start
		}
		if ents := dedupeSnapshotConditions(t.entityEventsLocked(false, true), chunks, from); len(ents) > 0 {
			backlog = append(backlog, ents)
		}
	}
	backlog = append(backlog, chunks...)
	if o.filter != nil {
		kept := backlog[:0:0]
		for _, b := range backlog {
			if f := filterEvents(b, o.filter); len(f) > 0 {
				kept = append(kept, f)
			}
		}
		backlog = kept
	}

	for _, b := range backlog {
		select {
		case ch <- b:
		default:
			logger.Println("history backlog does not fit, client dropped", clientId)
			return
		}
	}
	logger.Printf("send initial data with history: client=%d batches=%d", clientId, len(backlog))
	t.clientMap[clientId] = &eventClient{ctx: ctx, ch: ch, filter: o.filter}
}

func toEventEntityAppear(now int64, p *packet.EntityInfo) *event.EventEntityAppear {
	ownerId := ""
	if p.OwnerId != 0 {
		ownerId = strconv.FormatUint(p.OwnerId, 10)
	}

	return &event.EventEntityAppear{
		EventBase: event.EventBase{
			EventId: event.EventIdEntityAppear,
			At:      now,
			Id:      strconv.FormatUint(p.Id, 10),
		},
		Name:      p.Name,
		RaceId:    p.RaceId,
		Height:    p.Height,
		Weight:    p.Weight,
		Upper:     p.Upper,
		Lower:     p.Lower,
		GuildName: p.GuildName,
		OwnerId:   ownerId,

		SkinColor:     p.SkinColor,
		EyeType:       p.EyeType,
		EyeColor:      p.EyeColor,
		LeftEyeColor:  p.LeftEyeColor,
		RightEyeColor: p.RightEyeColor,
		MouthType:     p.MouthType,
	}
}

func toEventEquipItem(at int64, entityId uint64, v *packet.EntityItem) *event.EventEntityEquipItem {
	return &event.EventEntityEquipItem{
		EventBase: event.EventBase{
			EventId: event.EventIdEntityEquipItem,
			At:      at,
			Id:      strconv.FormatUint(entityId, 10),
		},
		PocketType: v.PocketType,
		ItemId:     v.ItemId,
		Color1:     fmt.Sprintf("#%06x", v.Color1),
		Color2:     fmt.Sprintf("#%06x", v.Color2),
		Color3:     fmt.Sprintf("#%06x", v.Color3),
		Color5:     fmt.Sprintf("#%06x", v.Color5),
		Color6:     fmt.Sprintf("#%06x", v.Color6),
		Color7:     fmt.Sprintf("#%06x", v.Color7),
	}
}

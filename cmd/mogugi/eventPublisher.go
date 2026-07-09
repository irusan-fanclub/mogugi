package main

import (
	"context"
	"encoding/binary"
	"fmt"
	"math"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/irusan-fanclub/mabidilmeter/lib/event"
	"github.com/irusan-fanclub/mabidilmeter/lib/packet"
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

	// mutable (guarded by the embedded mutex)
	r               *packet.GameServerPacketReader
	fwdCancel       context.CancelFunc
	fwdDone         chan struct{}
	entityCache     entityCache
	currentClientId uint32
	pendingEvents   []event.IEvent
	lastSentAt      time.Time
	lastPacketAt    time.Time
	lastRegion      uint32            // current region id (26009); 0 = unknown
	lastRegionName  string            // resolved display name of lastRegion (for "from X" logging)
	lastMission     string            // latest mission code (22007 enter_<code>), e.g. mrd
	lastMissionID   uint32            // latest mission id (45004); resolves via dungeonNames
	lastBGM         string            // currently playing BGM (43302); Boss_* means a boss fight
	bossEntities    map[uint64]string // live boss entity id -> boss name (race-id detection)
	dgnLog          dungeonLog        // per-run event file for whitelisted dungeons (own lock)
}

type eventClient struct {
	ctx context.Context
	ch  chan<- []event.IEvent
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

	t.startForwarder()

	if oldR == nil {
		logger.Printf("Initial reader installed (reason=%s)", reason)
		return
	}

	// Connection restarted; the dungeon log is void (where it cut off is
	// self-evident in the file).
	t.dgnLog.Close()

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

	for k, c := range t.clientMap {
		select {
		case <-c.ctx.Done():
			delete(t.clientMap, k)
			continue
		default:
		}

		select {
		case c.ch <- batch:
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
			t.Lock()
			t.lastPacketAt = time.Now()
			t.Unlock()

			t.handlePacket(p)
		}
	}
}

func (t *eventPublisher) handlePacket(p *packet.GamePacket) {
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

	case packet.OpcodeSetFinisher:
		t.handleSetFinisher(p)

	case packet.OpcodeCombatAction:
		t.handleCombatAction(p)

	case packet.OpcodeEffectDelayed:
		t.handleEffectDelayed(p)

	case packet.OpcodeConditionUpdate, packet.OpcodeConditionUpdate2:
		t.handleConditionUpdate(p)

	case packet.OpcodeChat:
		t.handleChat(p)

	case packet.OpcodeNotice:
		t.handleNotice(p)

	case packet.OpcodeStatUpdatePublic:
		t.handleStatUpdate(p)

	case packet.OpcodeMissionState:
		t.handleMissionState(p)

	case packet.OpcodeMissionStart:
		t.handleMissionStart(p)

	case packet.OpcodeBGMPlay:
		t.handleBGMPlay(p)

	case packet.OpcodeSetLocation:
		t.handleSetLocation(p)

	case packet.OpcodeChangeStance, packet.OpcodeChangeStanceRes:
		t.handleChangeStance(p)

	case packet.OpcodeChannelCharacterInfoR:
		t.handleChannelCharacterInfo(p)
	}
}

// handleChannelCharacterInfo parses an owner-only 0x5209 snapshot and writes
// the entity's inventory to {exedir}/items_log/{entity}.csv. This is a
// side-effect-only path (no client event); any failure is logged and ignored
// so metering is never disturbed.
func (t *eventPublisher) handleChannelCharacterInfo(p *packet.GamePacket) {
	snap, err := packet.ParseEntitySnapshot(p.Msg)
	if err != nil {
		itemLogger.Printf("parse 0x5209 failed: %v", err)
		return
	}
	if err := writeEntitySnapshot(snap); err != nil {
		itemLogger.Printf("write csv failed: %v", err)
		return
	}
	itemLogger.Printf("update %q (%d items)", snap.Name, len(snap.Items))
}

func (t *eventPublisher) handleEntityAppear(p *packet.GamePacket) {
	entity, err := packet.ParseEntityAppearPacket(p.Msg)
	if err != nil {
		logger.Println("ParseEntityAppearPacket failed:", err)
		return
	}

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
	t.entityCache.add(entity, p.At)

	events = append(events, toEventEntityAppear(p.At.Unix(), entity))

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
				At:      p.At.Unix(),
				Id:      strconv.FormatUint(entity.Id, 10),
			},
			CCId:       v.CCId,
			DisableAt:  v.DisableAt,
			AttackerId: attackerId,
		})
	}

	for _, v := range entity.EquipItemMap {
		if !t.entityCache.addOrUpdateEquipItem(entity.Id, v) {
			continue
		}
		events = append(events, toEventEquipItem(p.At.Unix(), entity.Id, v))
	}

	for _, pocketType := range t.entityCache.allEquipItemPockets(entity.Id) {
		if entity.EquipItemMap[pocketType] != nil {
			continue
		}
		t.entityCache.unequipItem(entity.Id, pocketType)
		events = append(events, &event.EventEntityUnequipItem{
			EventBase: event.EventBase{
				EventId: event.EventIdEntityUnequipItem,
				At:      p.At.Unix(),
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

func (t *eventPublisher) handleEntitiesAppear(p *packet.GamePacket) {
	entities, err := packet.ParseEntitiesAppearPacket(p)
	if err != nil {
		logger.Println("ParseEntitiesAppearPacket failed:", err)
		return
	}

	for _, entity := range entities {
		if len(entity.Name) <= 0 || entity.Name[0] == '_' {
			continue
		}

		t.Lock()
		t.entityCache.add(entity, p.At)
		t.Unlock()

		t.publish(toEventEntityAppear(p.At.Unix(), entity))
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
	if ttype != 318 {
		// Not 星塵 (Stardust)-family delayed damage (Blast 58100 / Flare
		// 58101 / combo 58009). The discriminator changed 317 -> 318 in
		// the 2026-06 update; see packet_capture_1781767719.
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

func (t *eventPublisher) handleConditionUpdate(p *packet.GamePacket) {
	cond, err := packet.ParseCharacterConditionPacket(p)
	if err != nil {
		logger.Println("ParseCharacterConditionPacket failed:", err)
		return
	}

	t.Lock()
	t.entityCache.addCondition(cond)
	t.Unlock()

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
		DisableAt:  cond.DisableAt,
		AttackerId: attackerId,
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

func (t *eventPublisher) handleNotice(p *packet.GamePacket) {
	// Notice packet: just a message string.
	if len(p.Msg) < 1 || p.Msg[0].Type() != packet.MessageElemTypeString {
		return
	}

	t.publish(&event.EventNotice{
		EventBase: event.EventBase{
			EventId: event.EventIdNotice,
			At:      p.At.Unix(),
			Id:      strconv.FormatUint(p.Id, 10),
		},
		Message: p.Msg[0].Data().(string),
	})
}

func (t *eventPublisher) handleStatUpdate(p *packet.GamePacket) {
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
	x := p.Msg[2].Data().(uint32)
	y := p.Msg[3].Data().(uint32)

	t.Lock()
	changed := region != t.lastRegion
	prevName := t.lastRegionName
	t.lastRegion = region
	missionID := t.lastMissionID
	var owner string
	if e, ok := t.entityCache[p.Id]; ok {
		owner = e.Name
	}
	t.Unlock()
	if !changed {
		return
	}

	// Resolve the new name now and remember it: resolving the PREVIOUS
	// region later would be wrong for dynamic instances (their name depends
	// on lastMissionID, which the next dungeon already overwrote).
	name := t.regionName(region)
	t.Lock()
	t.lastRegionName = name
	t.Unlock()

	if prevName != "" {
		logger.Printf("map change: %s (region=%d) pos=(%d,%d) from %s", name, region, x, y, prevName)
	} else {
		logger.Printf("map change: %s (region=%d) pos=(%d,%d)", name, region, x, y)
	}

	// Whitelisted dungeon -> tee to an event file; leaving (incl. warping
	// elsewhere) -> close it. Sub-map switches within a dungeon (dynamic->
	// dynamic, same mission, e.g. 布里萊赫/Brileith 35011->35013) count as
	// the same run and do not rotate the file.
	if code, ok := dungeonCodes[missionID]; ok && region >= 35000 {
		if t.dgnLog.IsOpen() {
			return
		}
		if owner == "" {
			owner = "unknown"
		}
		// Teammates already appeared before entry, so seed the file with an
		// entityCache snapshot or damage events won't map to player names.
		if err := t.dgnLog.Open(code, owner, p.At.Unix(), t.snapshotEvents()); err != nil {
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
	5225: "布倫塔納斯", 7602: "布倫塔納斯",
	5218: "雷楠的米勒", 7603: "雷楠的米勒",
	7615: "雷楠的米勒:悔恨",
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
		id, code := t.lastMissionID, t.lastMission
		t.Unlock()
		if n, ok := dungeonNames[id]; ok {
			return fmt.Sprintf("副本:%s", n)
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

// snapshotEvents rebuilds the entityCache into an event sequence (appear +
// condition + equip), shared by a new WS client's initial snapshot and the
// dungeon file's open-time seeding.
func (t *eventPublisher) snapshotEvents() []event.IEvent {
	initial := []event.IEvent(nil)

	t.Lock()
	for _, entity := range t.entityCache {
		initial = append(initial, toEventEntityAppear(entity.appearAt, entity.EntityInfo))

		for _, cond := range entity.characterConditionMap {
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
				DisableAt:  cond.DisableAt,
				AttackerId: attackerId,
			})
		}

		for _, item := range entity.equipItemMap {
			initial = append(initial, toEventEquipItem(entity.appearAt, entity.Id, item))
		}
	}
	t.Unlock()

	return initial
}

// addClient registers a new WebSocket client and sends it a snapshot of
// the current entity cache so the UI can render without waiting for new
// packets. Safe to call from its own goroutine.
func (t *eventPublisher) addClient(ctx context.Context, ch chan<- []event.IEvent) uint32 {
	t.Lock()
	t.currentClientId++
	clientId := t.currentClientId
	t.Unlock()

	initial := t.snapshotEvents()

	if len(initial) > 0 {
		logger.Printf("send initial data: client=%d events=%d", clientId, len(initial))
		ch <- initial
	}

	t.Lock()
	t.clientMap[clientId] = &eventClient{
		ctx: ctx,
		ch:  ch,
	}
	t.Unlock()

	return clientId
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

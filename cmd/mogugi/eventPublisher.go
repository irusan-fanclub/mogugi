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
	lastRegion      uint32 // 目前地圖 region id（26009），0=未知
	lastMission     string // 最近的副本任務代碼（22007 enter_<code>），如 mrd
	lastMissionID   uint32 // 最近的副本任務 id（45004），查 dungeonNames
	lastBGM         string // 目前播放的 BGM（43302），Boss_* 表示王戰中
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

// ResetSession handles a same-net channel switch: the reader stays (the
// wide filter still captures the new connection), but the parser's TCP
// sequence state now belongs to a new stream, so drop any in-flight
// packets and broadcast a session reset. readPacketLoop re-bases its
// sequence tracking on the new dst-port automatically.
func (t *eventPublisher) ResetSession(reason string) {
	t.Lock()
	t.lastPacketAt = time.Now()
	r := t.r
	t.Unlock()

	// Clear the reader's partial parse buffer: the kept reader is now seeing
	// a brand-new TCP stream, and leftover bytes from the old one would
	// corrupt the first packets (including the 0x5209 snapshot).
	if r != nil {
		r.ResetParseState()
	}

	drained := 0
	for {
		select {
		case <-t.packetCh:
			drained++
		default:
			if drained > 0 {
				logger.Printf("ResetSession: dropped %d in-flight packet(s)", drained)
			}
			logger.Printf("SessionReset: reason=%s", reason)
			t.publish(&event.EventSessionReset{
				EventBase: event.EventBase{
					EventId: event.EventIdSessionReset,
					At:      time.Now().Unix(),
					Id:      "0",
				},
				Reason: reason,
			})
			return
		}
	}
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
}

func (t *eventPublisher) loop() {
	const debug = false
	flushTicker := time.NewTicker(_eventFlushInterval / 2)
	defer flushTicker.Stop()

	for {
		select {
		case <-t.ctx.Done():
			return

		case <-flushTicker.C:
			t.flushNow()

		case p := <-t.packetCh:
			if debug {
				logger.Printf("packet op %s id %x", p.Op, p.Id)
				for i, msg := range p.Msg {
					logger.Println("* msg", i, msg.Type(), msg.String())
				}
			}

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
		logger.Printf("item-index: parse 0x5209 failed: %v", err)
		return
	}
	if err := writeEntitySnapshot(snap); err != nil {
		logger.Printf("item-index: write csv failed: %v", err)
		return
	}
	dir, _ := itemsLogDir()
	logger.Printf("item-index: wrote %q (%d items) -> %s", snap.Name, len(snap.Items), dir)
}

func (t *eventPublisher) handleEntityAppear(p *packet.GamePacket) {
	entity, err := packet.ParseEntityAppearPacket(p.Msg)
	if err != nil {
		logger.Println("ParseEntityAppearPacket failed:", err)
		return
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
			for j, m := range p.Msg {
				logger.Println("* msg", j, m.Type(), m.String())
			}
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
		// Not 星塵-family delayed damage (Blast 58100 / Flare 58101 /
		// 連續攻擊 58009). The discriminator changed 317 -> 318 in the
		// 2026-06 update; see packet_capture_1781767719.
		return
	}

	if len(p.Msg) < 7 ||
		p.Msg[2].Type() != packet.MessageElemTypeInt ||
		p.Msg[5].Type() != packet.MessageElemTypeLong ||
		p.Msg[6].Type() != packet.MessageElemTypeShort {
		logger.Printf("EffectDelayed: invalid packet op=%s id=%x", p.Op, p.Id)
		for i, msg := range p.Msg {
			logger.Println("* msg", i, msg.Type(), msg.String())
		}
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
	t.lastRegion = region
	t.Unlock()
	if changed {
		logger.Printf("map change: %s (region=%d) pos=(%d,%d)", t.regionName(region), region, x, y)
	}
}

// missionNames：副本任務代碼 → 顯示名（由 minimap jpg 命名對照 MinimapInfo
// 得出，如 minimap_2024_mrd_* → 穆利亞斯；逐步擴充）。
var missionNames = map[string]string{
	"mrd": "穆利亞斯",
}

// handleMissionState 記下 enter_<code> 任務代碼；緊接的動態 region 26009
// 會用它命名副本。
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

// handleMissionStart 記下副本任務 id（45004 在動態 region 的 26009 前送達）。
func (t *eventPublisher) handleMissionStart(p *packet.GamePacket) {
	if len(p.Msg) < 1 || p.Msg[0].Type() != packet.MessageElemTypeInt {
		return
	}
	id, _ := p.Msg[0].Data().(uint32)
	t.Lock()
	t.lastMissionID = id
	t.Unlock()
}

// bossBGMNames：王戰 BGM 檔名 → 王名。縮寫對照 DungeonCheckPoint（布里萊赫：
// BT=布倫塔納斯、LM=雷楠的米勒）；VT 為一王（名稱待實測確認）。
var bossBGMNames = map[string]string{
	"Boss_BT.mp3": "布倫塔納斯",
	"Boss_LM.mp3": "雷楠的米勒",
}

// handleBGMPlay 以 BGM 切換偵測王戰開始/結束：切到 Boss_*.mp3 = 開打，
// 從 Boss_* 切回其他曲子 = 結束。
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

// regionName 回傳地圖名；>=35000 為動態副本實例（每次進入配發新 id），
// 不在靜態表中，改用最近的任務 id / 任務代碼命名。
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

// addClient registers a new WebSocket client and sends it a snapshot of
// the current entity cache so the UI can render without waiting for new
// packets. Safe to call from its own goroutine.
func (t *eventPublisher) addClient(ctx context.Context, ch chan<- []event.IEvent) uint32 {
	t.Lock()
	t.currentClientId++
	clientId := t.currentClientId
	t.Unlock()

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

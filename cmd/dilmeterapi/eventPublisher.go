package main

import (
	"context"
	"encoding/binary"
	"fmt"
	"math"
	"strconv"
	"sync"
	"time"

	"gitlab.com/prilus/mabidilmeter/lib/event"
	"gitlab.com/prilus/mabidilmeter/lib/packet"
)

const (
	// Batch up events until we hit this count or the flush interval.
	_maxPendingEvents   = 100
	_eventFlushInterval = 100 * time.Millisecond
)

type eventPublisher struct {
	sync.Mutex

	// non-mutable
	ctx         context.Context
	r           *packet.GameServerPacketReader
	clientMap   map[uint32]*eventClient
	entityCache entityCache

	// mutable (guarded by the embedded mutex)
	currentClientId uint32
	pendingEvents   []event.IEvent
	lastSentAt      time.Time
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
		entityCache:     make(entityCache),
		currentClientId: 1,
		pendingEvents:   make([]event.IEvent, 0, _maxPendingEvents),
		lastSentAt:      time.Now(),
	}

	go v.loop()

	return v
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

		case p := <-t.r.PacketCh():
			if debug {
				logger.Printf("packet op %s id %x", p.Op, p.Id)
				for i, msg := range p.Msg {
					logger.Println("* msg", i, msg.Type(), msg.String())
				}
			}

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

	case packet.OpcodeChangeStance, packet.OpcodeChangeStanceRes:
		t.handleChangeStance(p)
	}
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
	if ttype != 317 {
		// Not a Chain Blade Blast
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

	logger.Println("send initial data", clientId, ",", len(initial), "events")

	if len(initial) > 0 {
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

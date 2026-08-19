package event

type EventId int16

const (
	EventIdEntityAppear EventId = 1 + iota
	EventIdEntityDisappear
	EventIdDamage
	EventIdCharacterConditionEnable
	EventIdCharacterConditionDisable
	EventIdFinish
	EventIdEntityEquipItem
	EventIdEntityUnequipItem
	EventIdEntityUpdateBody
	EventIdStatUpdate
	EventIdChat
	EventIdNotice
	EventIdChangeStance
	EventIdOwnerCharacter
	EventIdSkillCast
	EventIdBardsong
	EventIdSkillUse
	EventIdSkillPrepareStart
	EventIdSkillStop
	EventIdMaxLife
	EventIdEntityDown
)

// System-level events use negative IDs so they can be filtered out
// from persistence.
const (
	EventIdMessageBox EventId = -1 - iota
	EventIdSessionReset
)

type IEvent interface {
	GetEventId() EventId
}

type EventBase struct {
	EventId EventId
	At      int64
	Id      string
}

func (t *EventBase) GetEventId() EventId {
	return t.EventId
}

type EventEntityAppear struct {
	EventBase
	Name      string
	RaceId    uint32
	Height    float32
	Weight    float32
	Upper     float32
	Lower     float32
	GuildName string
	OwnerId   string
}

type EventEntityDisappear struct {
	EventBase
}

type EventDamage struct {
	EventBase
	TargetId   string
	SkillId    uint16
	Damage     float32
	IsCritical bool
	IsDelayed  bool
}

type EventCharacterConditionEnable struct {
	EventBase
	CCId       uint32
	DisableAt  int64
	AttackerId string
	// Params carries the condition's magnitudes; see lib/packet.
	Params map[string]string
}

type EventCharacterConditionDisable struct {
	EventBase
	CCId uint32
}

type EventFinish struct {
	EventBase
	AttackerId string
}

type EventEntityEquipItem struct {
	EventBase
	PocketType uint32
	ItemId     uint32
	Color1     string
	Color2     string
	Color3     string
	Color5     string
	Color6     string
	Color7     string
}

type EventEntityUnequipItem struct {
	EventBase
	PocketType uint32
}

type EventEntityUpdateBody struct {
	EventBase
	Height float32
	Weight float32
	Upper  float32
	Lower  float32
}

type EventStatUpdate struct {
	EventBase
	// Raw bytes payload forwarded to the frontend for interpretation.
	Data []byte
}

type EventChat struct {
	EventBase
	Channel uint8
	From    string
	Message string
}

// EventNotice carries a 0x526D notice. Category separates a message about
// the local character (4) from server-wide (2) and world-event (3) broadcasts;
// it is on the event because consumers cannot recover it from Message.
type EventNotice struct {
	EventBase
	Category uint8
	Message  string
}

type EventChangeStance struct {
	EventBase
	Stance uint8
}

// EventSkillCast fires when an entity's skill goes off, damaging or not.
// Id is the caster. Superseded by EventSkillUse, which covers far more of the
// same ground (263 skills / 13,926 casters against 13 / 141 in one capture).
type EventSkillCast struct {
	EventBase
	SkillId uint16
}

// EventBardsong carries a bard-song announcement's magnitudes. Id is always
// the local player: the announcement is private and never names anyone else.
type EventBardsong struct {
	EventBase
	Performer string
	Song      string
	Bonuses   map[string]float64
	IsEnd     bool
}

// EventSkillUse fires from the broadcast combat-action packet (0x7926) for
// the attacker's sub-packet, damaging or not — the only broadcast source
// that also sees buff and utility skills, unlike EventDamage's SkillId.
type EventSkillUse struct {
	EventBase
	SkillId uint16
}

// EventOwnerCharacter announces the local character (name may lag until known).
type EventOwnerCharacter struct {
	EventBase
	Name string
}

// EventSkillPrepareStart fires when the local player starts channeling a
// skill (0x6984). Self-only: no broadcast source sees this for anyone else.
type EventSkillPrepareStart struct {
	EventBase
	SkillId uint16
}

// EventSkillStop fires when the local player's channeled skill ends
// (0x698B). The opcode itself carries no skill id; SkillId is the one
// remembered from the matching EventSkillPrepareStart.
type EventSkillStop struct {
	EventBase
	SkillId uint16
}

type EventMessageBox struct {
	EventBase
	Message string
}

// EventSessionReset signals the frontend to wipe per-session state.
// Reason values: "channel_switch", "idle_fallback".
type EventSessionReset struct {
	EventBase
	Reason string
}

// EventMaxLife reports an entity's maximum life from the public stat
// update (0x7532), published only when first seen or changed (phase swap).
type EventMaxLife struct {
	EventBase
	MaxLife float64
}

// EventEntityDown fires once when a tracked boss's public life (0x7532)
// crosses zero — the definitive kill signal for run summaries.
type EventEntityDown struct {
	EventBase
}

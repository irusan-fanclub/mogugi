package event

import (
	"encoding/json"

	"github.com/irusan-fanclub/mogugi/lib/packet"
)

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
	EventIdCaptureStatus
	EventIdOwnerEquipment
	EventIdOwnerStats
	EventIdBardsongPulse
	EventIdEntityLife
	EventIdEntityDeath
	EventIdEntityInvincible
	EventIdClockShift
)

// System-level events use negative IDs so they can be filtered out
// from persistence.
const (
	EventIdMessageBox EventId = -1 - iota
	EventIdSessionReset
	EventIdConfigChanged
	EventIdSourceChanged
	EventIdHistoryEvicted
	EventIdBattleBoundary
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

func (t *EventBase) GetAt() int64 {
	return t.At
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
	// Look fields feed the character simulator; omitted when zero.
	SkinColor     uint8  `json:"SkinColor,omitempty"`
	EyeType       uint16 `json:"EyeType,omitempty"`
	EyeColor      uint8  `json:"EyeColor,omitempty"`
	LeftEyeColor  uint8  `json:"LeftEyeColor,omitempty"`
	RightEyeColor uint8  `json:"RightEyeColor,omitempty"`
	MouthType     uint16 `json:"MouthType,omitempty"`
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
	// IsFinish marks the killing blow; omitted when false to keep logs small.
	IsFinish bool `json:",omitempty"`
}

type EventCharacterConditionEnable struct {
	EventBase
	CCId       uint32
	DisableAt  float64
	AttackerId string
	// ClockGen is the clock generation DisableAt was converted under; a later shift moves only older ones.
	ClockGen int `json:",omitempty"`
	// LocalClock marks a DisableAt derived from capture time, which no clock shift applies to.
	LocalClock bool `json:",omitempty"`
	// Params carries the condition's magnitudes; see lib/packet.
	Params map[string]string
}

// EventClockShift moves every already published local DisableAt by ShiftSec
// seconds; the server clock estimate changed after they were converted.
type EventClockShift struct {
	EventBase
	ShiftSec float64
	// Gen is the clock generation this shift creates.
	Gen int
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

// EventBardsongPulse fires from the performer's 0x9093 kind-21 effect while
// a bard song plays. Id is the performer; Targets lists the entities the song
// reached on this pulse (each gets the buff for a fixed span), or is empty
// with Stop set when the performer stops. The EventBardsong announcement
// reaches the whole party even when the local player was out of range, so
// this is the only per-entity signal.
type EventBardsongPulse struct {
	EventBase
	Targets []string
	Stop    bool
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

// EventHistoryEvicted tells the frontend that history before At was dropped.
// Present lists the entity ids the backend still knows (EntityAppear id format).
type EventHistoryEvicted struct {
	EventBase
	Present []string
}

// EventBattleBoundary marks At as the start of a new battle segment.
// Present lists the entity ids the backend still knows.
type EventBattleBoundary struct {
	EventBase
	Present []string
}

type EventMessageBox struct {
	EventBase
	Message string
}

// EventConfigChanged carries the saved /api/config fields after a PUT.
type EventConfigChanged struct {
	EventBase
	Config json.RawMessage
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

// EventEntityLife reports a boss's current life from the public stat
// update (0x7532), throttled to one change per second.
type EventEntityLife struct {
	EventBase
	Life float64
}

// EventEntityDeath reports a player dying (0x53FC) or reviving (0x53FD for
// the owner, public life back above zero for anyone).
type EventEntityDeath struct {
	EventBase
	Dead bool
}

// EventEntityInvincible is the 0x7533 flag as older logs recorded it; it is
// now published as condition 91000 and only read back from those logs.
type EventEntityInvincible struct {
	EventBase
	On bool
}

// EventEntityDown fires once when a tracked boss's public life (0x7532)
// crosses zero — the definitive kill signal for run summaries.
type EventEntityDown struct {
	EventBase
}

// EventCaptureStatus reports live packet-capture health, published by the
// connection watchdog on any state change and included in a new client's
// initial snapshot. LastPacketAt is 0 if no reader has ever been installed.
type EventCaptureStatus struct {
	EventBase
	NpcapOk      bool
	GameDetected bool
	Capturing    bool
	LastPacketAt int64
}

// EquipmentItem is one worn item of the local character. Item holds the
// internal/app IndexItem (same JSON as /api/item-index); typed any because
// lib/event cannot import internal/app.
type EquipmentItem struct {
	Pocket uint32 `json:"pocket"`
	EID    string `json:"eid"`
	Item   any    `json:"item"`
}

// EventOwnerEquipment carries the local character's whole worn set. Sent
// on snapshot, on every equip change, and in a new client's initial batch.
type EventOwnerEquipment struct {
	EventBase
	Items []EquipmentItem
}

// EventOwnerStats carries the local character's derived stat panel; the
// publisher only sends it when a value actually changed.
type EventOwnerStats struct {
	EventBase
	Panel packet.Panel
}

// SourceState describes where events come from: live capture or a replay.
type SourceState struct {
	Mode     string // "live" | "replay"
	File     string // replay file base name
	Done     int64
	Total    int64
	Finished bool
	Err      string
	Notice   string
	// ClientVersion is the game client build, e.g. "tw169"; empty if unknown.
	ClientVersion string `json:"ClientVersion,omitempty"`
}

// EventSourceChanged is broadcast when the event source or replay progress changes.
type EventSourceChanged struct {
	EventBase
	SourceState
}

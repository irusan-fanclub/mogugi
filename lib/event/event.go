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
)

// System-level events use negative IDs so they can be filtered out
// from persistence.
const (
	EventIdMessageBox EventId = -1 - iota
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

type EventNotice struct {
	EventBase
	Message string
}

type EventChangeStance struct {
	EventBase
	Stance uint8
}

type EventMessageBox struct {
	EventBase
	Message string
}

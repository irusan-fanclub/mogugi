package packet

import (
	"bytes"
	"fmt"

	"github.com/irusan-fanclub/mogugi/lib/util"
)

type EntityInfo struct {
	Id                    uint64
	Name                  string
	RaceId                uint32
	SkinColor             uint8
	EyeType               uint16
	LeftEyeColor          uint8
	RightEyeColor         uint8
	MouthType             uint16
	Height                float32
	Weight                float32
	Upper                 float32
	Lower                 float32
	TitleId               uint32
	SubTitleId            uint32
	StyleTitleId          uint32
	StyleSubTitleId       uint32
	EquipItemMap          map[uint32]*EntityItem
	CharacterConditionMap map[uint32]*EntityCharacterCondition
	GuildName             string
	OwnerId               uint64 // Pet, Marionette, etc.
}

type EntityItem struct {
	// public data
	PocketType uint32
	ItemId     uint32
	Color1     uint32
	Color2     uint32
	Color3     uint32
	Color4     uint32
	Color5     uint32
	Color6     uint32
	Color7     uint32
	Amount     uint16
}

type EntityCharacterCondition struct {
	CCId       uint32
	DisableAt  int64
	AttackerId uint64
	// Params holds the KEY:type:value; triples of element 3 — the only
	// place an effect's magnitudes appear. Empty on a disable update.
	Params map[string]string
}

func ParseEntityAppearPacket(msg Message) (*EntityInfo, error) {
	origMsg := msg

	curPos := func() int {
		return len(origMsg) - len(msg)
	}

	if len(msg) < 2 || msg[1].Type() != MessageElemTypeByte {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	dataType := msg[1].Data().(uint8)
	if dataType != 5 {
		// Only read public data
		return nil, nil
	}

	v := &EntityInfo{
		EquipItemMap:          make(map[uint32]*EntityItem),
		CharacterConditionMap: make(map[uint32]*EntityCharacterCondition),
	}

	if len(msg) < 40 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		return nil, err
	}

	if msg[0].Type() != MessageElemTypeLong {
		err := fmt.Errorf("id has unexpected type %v", msg[0].Type())
		logger.Println(err)
		return nil, err
	}

	v.Id = msg[0].Data().(uint64)

	if msg[2].Type() != MessageElemTypeString {
		err := fmt.Errorf("name has unexpected type %v", msg[2].Type())
		logger.Println(err)
		return nil, err
	}

	v.Name = msg[2].Data().(string)

	if msg[5].Type() != MessageElemTypeInt {
		err := fmt.Errorf("raceId has unexpected type %v", msg[5].Type())
		logger.Println(err)
		return nil, err
	}

	v.RaceId = msg[5].Data().(uint32)

	if msg[6].Type() != MessageElemTypeByte {
		err := fmt.Errorf("skinColor has unexpected type %v", msg[6].Type())
		logger.Println(err)
		return nil, err
	}

	v.SkinColor = msg[6].Data().(uint8)

	if msg[7].Type() != MessageElemTypeShort {
		err := fmt.Errorf("eyeType has unexpected type %v", msg[7].Type())
		logger.Println(err)
		return nil, err
	}

	v.EyeType = msg[7].Data().(uint16)

	if msg[8].Type() != MessageElemTypeByte {
		err := fmt.Errorf("eyeColor has unexpected type %v", msg[8].Type())
		logger.Println(err)
		return nil, err
	}

	eyeColor := msg[8].Data().(uint8)

	if msg[9].Type() != MessageElemTypeShort {
		err := fmt.Errorf("mouthType has unexpected type %v", msg[9].Type())
		logger.Println(err)
		return nil, err
	}

	v.MouthType = msg[9].Data().(uint16)

	if msg[13].Type() != MessageElemTypeFloat {
		err := fmt.Errorf("height has unexpected type %v", msg[13].Type())
		logger.Println(err)
		return nil, err
	}

	v.Height = msg[13].Data().(float32)

	if msg[14].Type() != MessageElemTypeFloat {
		err := fmt.Errorf("weight has unexpected type %v", msg[14].Type())
		logger.Println(err)
		return nil, err
	}

	v.Weight = msg[14].Data().(float32)

	if msg[15].Type() != MessageElemTypeFloat {
		err := fmt.Errorf("upper has unexpected type %v", msg[15].Type())
		logger.Println(err)
		return nil, err
	}

	v.Upper = msg[15].Data().(float32)

	if msg[16].Type() != MessageElemTypeFloat {
		err := fmt.Errorf("lower has unexpected type %v", msg[16].Type())
		logger.Println(err)
		return nil, err
	}

	v.Lower = msg[16].Data().(float32)

	if msg[28].Type() != MessageElemTypeByte {
		err := fmt.Errorf("leftEyeColor has unexpected type %v", msg[28].Type())
		logger.Println(err)
		return nil, err
	}

	v.LeftEyeColor = msg[28].Data().(uint8)

	if v.LeftEyeColor == 0 {
		v.LeftEyeColor = eyeColor
	}

	if msg[29].Type() != MessageElemTypeByte {
		err := fmt.Errorf("rightEyeColor has unexpected type %v", msg[29].Type())
		logger.Println(err)
		return nil, err
	}

	v.RightEyeColor = msg[29].Data().(uint8)

	if v.RightEyeColor == 0 {
		v.RightEyeColor = eyeColor
	}

	if msg[39].Type() != MessageElemTypeInt {
		err := fmt.Errorf("regenCount has unexpected type %v", msg[39].Type())
		logger.Println(err)
		return nil, err
	}

	regenCount := msg[39].Data().(uint32)

	msg = msg[40:]

	if len(msg) < 7*int(regenCount) {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	msg = msg[7*regenCount:]

	if len(msg) < 1 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	if msg[0].Type() != MessageElemTypeInt {
		err := fmt.Errorf("regen2Count has unexpected type %v", msg[0].Type())
		logger.Println(err)
		return nil, err
	}

	regen2Count := msg[0].Data().(uint32)
	msg = msg[1:]

	if len(msg) < 7*int(regen2Count) {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	msg = msg[7*regen2Count:]

	if len(msg) < 10 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	if msg[0].Type() != MessageElemTypeInt {
		err := fmt.Errorf("titleId has unexpected type %v", msg[0].Type())
		logger.Println(err)
		return nil, err
	}

	v.TitleId = msg[0].Data().(uint32)

	if msg[2].Type() != MessageElemTypeInt {
		err := fmt.Errorf("subTitleId has unexpected type %v", msg[2].Type())
		logger.Println(err)
		return nil, err
	}

	v.SubTitleId = msg[2].Data().(uint32)

	if msg[3].Type() != MessageElemTypeInt {
		err := fmt.Errorf("styleTitleId has unexpected type %v", msg[3].Type())
		logger.Println(err)
		return nil, err
	}

	v.StyleTitleId = msg[3].Data().(uint32)

	if msg[4].Type() != MessageElemTypeInt {
		err := fmt.Errorf("styleSubTitleId has unexpected type %v", msg[4].Type())
		logger.Println(err)
		return nil, err
	}

	v.StyleSubTitleId = msg[4].Data().(uint32)

	if msg[9].Type() != MessageElemTypeInt {
		err := fmt.Errorf("unk1Count has unexpected type %v", msg[9].Type())
		logger.Println(err)
		return nil, err
	}

	unk1Count := msg[9].Data().(uint32)
	msg = msg[10:]

	if len(msg) < 2*int(unk1Count) {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	msg = msg[2*unk1Count:]

	if len(msg) < 1 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	if msg[0].Type() != MessageElemTypeInt {
		err := fmt.Errorf("equipItemCount has unexpected type %v", msg[0].Type())
		logger.Println(err)
		return nil, err
	}

	equipItemCount := int(msg[0].Data().(uint32))
	msg = msg[1:]

	if len(msg) < 2*equipItemCount {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	for i := 0; i < equipItemCount; i, msg = i+1, msg[2:] {
		if len(msg) < 2 {
			err := fmt.Errorf("equipItem slot %d: not enough elements", i)
			logger.Println(err)
			return nil, err
		}
		if msg[1].Type() != MessageElemTypeBin {
			err := fmt.Errorf("equipItemData has unexpected type %v", msg[1].Type())
			logger.Println(err)
			return nil, err
		}

		b := msg[1].Data().([]byte)
		d, err := EntityItemReader(b)
		if err != nil {
			logger.Println("EntityItemReader failed:", err, i)
			return nil, err
		}

		v.EquipItemMap[d.PocketType] = d

		// Guild robes carry an extra optional string field after the item.
		if len(msg) >= 3 && msg[2].Type() == MessageElemTypeString {
			msg = msg[1:]
		}
	}

	// Skill related
	if len(msg) < 4 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	if msg[3].Type() != MessageElemTypeInt {
		err := fmt.Errorf("skillCount has unexpected type %v", msg[3].Type())
		logger.Println(err)
		return nil, err
	}

	skillCount := int(msg[3].Data().(uint32))
	msg = msg[4:]

	if len(msg) < skillCount {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	msg = msg[skillCount:]

	// unknown field
	if len(msg) < 2 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	msg = msg[2:]

	// Party related
	if len(msg) < 2 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	msg = msg[2:]

	// PVP related
	if len(msg) < 16 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	msg = msg[16:]

	// Condition related
	if len(msg) < 3 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	if msg[2].Type() != MessageElemTypeInt {
		err := fmt.Errorf("conditionCount has unexpected type %v", msg[2].Type())
		logger.Println(err)
		return nil, err
	}

	conditionCount := int(msg[2].Data().(uint32))
	msg = msg[3:]

	if len(msg) < (conditionCount * 6) {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	for i := 0; i < conditionCount; i, msg = i+1, msg[6:] {
		/*
			uint32 ccId
			uint64 disableAt
			string metadata - may be needed later
			uint64 attackerId
			string unknown1
			string message on release?
		*/

		if msg[0].Type() != MessageElemTypeInt {
			err := fmt.Errorf("ccId has unexpected type %v", msg[0].Type())
			logger.Println(err)
			return nil, err
		}

		ccId := msg[0].Data().(uint32)

		if msg[1].Type() != MessageElemTypeLong {
			err := fmt.Errorf("disableAt has unexpected type %v", msg[1].Type())
			logger.Println(err)
			return nil, err
		}

		disableAtRaw := msg[1].Data().(uint64)
		disableAt := util.ParseMabiTime(disableAtRaw).Unix()

		params := map[string]string{}
		if msg[2].Type() == MessageElemTypeString {
			params = ParseConditionParams(msg[2].Data().(string))
		}

		if msg[3].Type() != MessageElemTypeLong {
			err := fmt.Errorf("attackerId has unexpected type %v", msg[3].Type())
			logger.Println(err)
			return nil, err
		}

		attackerId := msg[3].Data().(uint64)

		v.CharacterConditionMap[ccId] = &EntityCharacterCondition{
			CCId:       ccId,
			DisableAt:  disableAt,
			AttackerId: attackerId,
			Params:     params,
		}
	}

	// unknown field
	if len(msg) < 1 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	msg = msg[1:]

	// Guild related
	if len(msg) < 33 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	if msg[1].Type() != MessageElemTypeString {
		err := fmt.Errorf("guildName has unexpected type %v", msg[1].Type())
		logger.Println(err)
		return nil, err
	}

	v.GuildName = msg[1].Data().(string)
	msg = msg[33:]

	// unknown field
	if len(msg) < 1 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	if msg[0].Type() != MessageElemTypeByte {
		err := fmt.Errorf("unk2Flag has unexpected type %v", msg[0].Type())
		logger.Println(err)
		return nil, err
	}

	unk2Flag := msg[0].Data().(uint8)
	msg = msg[1:]

	if unk2Flag != 0 {
		if len(msg) < 1 {
			err := fmt.Errorf("entity appear data is too short %v", curPos())
			logger.Println(err)
			return nil, err
		}

		msg = msg[1:]
	}

	// unknown field
	if len(msg) < 2 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	if msg[1].Type() != MessageElemTypeByte {
		err := fmt.Errorf("unk3Flag has unexpected type %v", msg[1].Type())
		logger.Println(err)
		return nil, err
	}

	unk3Flag := msg[1].Data().(uint8)
	msg = msg[2:]

	if unk3Flag != 0 {
		if len(msg) < 1 {
			err := fmt.Errorf("entity appear data is too short %v", curPos())
			logger.Println(err)
			return nil, err
		}

		msg = msg[1:]
	}

	if len(msg) < 7 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	unk4Flag := msg[6].Data().(uint8)
	msg = msg[7:]

	if unk4Flag != 0 {
		// 5, 5, 5, 5, 5, 5, 5
		if len(msg) < 7 {
			err := fmt.Errorf("entity appear data is too short %v", curPos())
			logger.Println(err)
			return nil, err
		}

		msg = msg[7:]
	}

	// unknown field
	if len(msg) < 14 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	msg = msg[14:]

	// 4, ...
	if len(msg) < 2 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	if msg[0].Type() != MessageElemTypeLong {
		err := fmt.Errorf("unk4 has unexpected type %v", msg[0].Type())
		logger.Println(err)
		return nil, err
	}

	// 4, 6...
	if msg[1].Type() == MessageElemTypeString {
		if len(msg) < 6 {
			err := fmt.Errorf("entity appear data is too short %v", curPos())
			logger.Println(err)
			return nil, err
		}

		if msg[2].Type() == MessageElemTypeString {
			// 4, 6, 6, 1, 1, 5, 1, ...  (post game-update format)
			msg = msg[6:]
		} else if msg[5].Type() == MessageElemTypeString {
			// 4, 6, 2, 2, 2, 6, ...
			msg = msg[5:]
		} else {
			err := fmt.Errorf("entity appear data is too short %v", curPos())
			logger.Println(err)
			return nil, err
		}
	}

	// 4, ...
	msg = msg[1:]

	// Pet related.
	// Owner id sits at msg[4] for a player owner, msg[3] for a monster/boss
	// owner; auto-detect by which is a Long.
	if len(msg) < 5 {
		err := fmt.Errorf("entity appear data is too short %v", curPos())
		logger.Println(err)
		return nil, err
	}

	ownerIdIdx := -1
	if msg[3].Type() == MessageElemTypeLong {
		ownerIdIdx = 3
	} else if msg[4].Type() == MessageElemTypeLong {
		ownerIdIdx = 4
	} else {
		err := fmt.Errorf("ownerId not found (msg[3]=%v msg[4]=%v)", msg[3].Type(), msg[4].Type())
		logger.Println(err)
		return nil, err
	}

	v.OwnerId = msg[ownerIdIdx].Data().(uint64)

	return v, nil
}

func ParseEntitiesAppearPacket(p *GamePacket) ([]*EntityInfo, error) {
	entities := []*EntityInfo(nil)
	msg := p.Msg
	if len(msg) < 1 || msg[0].Type() != MessageElemTypeShort {
		return nil, fmt.Errorf("invalid packet")
	}

	count := int(msg[0].Data().(uint16))
	msg = msg[1:]

	for i := 0; i < count; i++ {
		if len(msg) < 3 {
			logger.Printf("ParseEntitiesAppearPacket: not enough data at index %d, remaining=%d\n", i, len(msg))
			break
		}

		if msg[0].Type() != MessageElemTypeShort ||
			msg[1].Type() != MessageElemTypeInt ||
			msg[2].Type() != MessageElemTypeBin {

			logger.Println("invalid packet", i)
			continue
		}

		t, b := msg[0].Data().(uint16), msg[2].Data().([]byte)
		if t != 16 {
			// Not a character
			// logger.Println("invalid packet", i, t)
			continue
		}

		msg = msg[3:]

		_, _, subMsg, err := GamePacketBodyReader(bytes.NewReader(b))
		if err != nil {
			logger.Println("GamePacketBodyReader failed:", err)
			continue
		}

		v, err := ParseEntityAppearPacket(subMsg)
		if err != nil {
			logger.Println("ParseEntityAppearPacket failed:", err)
			continue
		}

		if v != nil {
			entities = append(entities, v)
		}

	}

	return entities, nil
}

func EntityItemReader(b []byte) (*EntityItem, error) {
	r := new(EntityItem)
	if len(b) < 38 {
		err := fmt.Errorf("item public info data is too short %v", len(b))
		return nil, err
	}

	r.PocketType = le.Uint32(b[0:]) // Probably uint8?
	r.ItemId = le.Uint32(b[4:])
	r.Color1 = le.Uint32(b[8:])
	r.Color2 = le.Uint32(b[12:])
	r.Color3 = le.Uint32(b[16:])
	r.Color4 = le.Uint32(b[20:])
	r.Color5 = le.Uint32(b[24:])
	r.Color6 = le.Uint32(b[28:])
	r.Color7 = le.Uint32(b[32:])
	r.Amount = le.Uint16(b[36:])
	if r.Amount == 0 {
		r.Amount = 1
	}

	return r, nil
}

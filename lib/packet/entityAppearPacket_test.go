package packet

import "testing"

// appearCondition is one condition block of an entity-appear packet.
type appearCondition struct {
	ccId       uint32
	attackerId uint64
	params     string
}

func zeroInts(n int) Message {
	m := make(Message, n)
	for i := range m {
		m[i] = NewMessageElemInt(0)
	}
	return m
}

// entityAppearMessage assembles a minimal public-data (dataType 5) appear
// packet: no regen entries, no equipment, no skills, and the given conditions.
func entityAppearMessage(id uint64, raceId uint32, name string, ownerId uint64, conds ...appearCondition) Message {
	head := zeroInts(40)
	head[0] = NewMessageElemLong(id)
	head[1] = NewMessageElemByte(5)
	head[2] = NewMessageElemString(name)
	head[5] = NewMessageElemInt(raceId)
	head[6] = NewMessageElemByte(0)
	head[7] = NewMessageElemShort(0)
	head[8] = NewMessageElemByte(3)
	head[9] = NewMessageElemShort(0)
	head[13] = NewMessageElemFloat(1)
	head[14] = NewMessageElemFloat(1)
	head[15] = NewMessageElemFloat(1)
	head[16] = NewMessageElemFloat(1)
	head[28] = NewMessageElemByte(0)
	head[29] = NewMessageElemByte(0)
	// head[39] is regenCount, left at 0.

	msg := append(Message{}, head...)
	msg = append(msg, NewMessageElemInt(0)) // regen2Count
	msg = append(msg, zeroInts(10)...)      // titles, unk1Count = 0
	msg = append(msg, NewMessageElemInt(0)) // equipItemCount
	msg = append(msg, zeroInts(4)...)       // skill header, skillCount = 0
	msg = append(msg, zeroInts(2)...)       // unknown
	msg = append(msg, zeroInts(2)...)       // party
	msg = append(msg, zeroInts(16)...)      // pvp

	condHeader := zeroInts(3)
	condHeader[2] = NewMessageElemInt(uint32(len(conds)))
	msg = append(msg, condHeader...)
	for _, c := range conds {
		msg = append(msg,
			NewMessageElemInt(c.ccId),
			NewMessageElemLong(63922323583596),
			NewMessageElemString(c.params),
			NewMessageElemLong(c.attackerId),
			NewMessageElemString(""),
			NewMessageElemString(""),
		)
	}

	msg = append(msg, NewMessageElemInt(0)) // unknown

	guild := zeroInts(33)
	guild[1] = NewMessageElemString("")
	msg = append(msg, guild...)

	msg = append(msg, NewMessageElemByte(0)) // unk2Flag

	unk3 := zeroInts(2)
	unk3[1] = NewMessageElemByte(0)
	msg = append(msg, unk3...)

	unk4 := zeroInts(7)
	unk4[6] = NewMessageElemByte(0)
	msg = append(msg, unk4...)

	msg = append(msg, zeroInts(14)...) // unknown

	// Tail: a Long, a non-String next to it (so the post-update variant is
	// not taken), then the pet block with the owner id in the player slot.
	msg = append(msg,
		NewMessageElemLong(0),
		NewMessageElemInt(0), NewMessageElemInt(0),
		NewMessageElemInt(0), NewMessageElemInt(0),
		NewMessageElemLong(ownerId),
	)
	return msg
}

// The condition parameter string is the only carrier of a buff's magnitudes;
// dropping it renders as "no buff", which looks exactly like the real thing.
func TestParseEntityAppearPacketCarriesConditionParams(t *testing.T) {
	msg := entityAppearMessage(4503599630022047, 10002, "地域磨菇", 0,
		appearCondition{ccId: 680, attackerId: 4503599629596015,
			params: "MCMBAMIN:f:32.200001;MCMBAMAX:f:32.200001;SBT:8:63922323583596;"},
		appearCondition{ccId: 1026, params: "DF:f:206;PR:f:226;DIS:4:2000;LIFE:f:342.25;"},
		appearCondition{ccId: 494, params: "VAL:2:2;"},
	)

	v, err := ParseEntityAppearPacket(msg)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if v == nil {
		t.Fatal("parse returned no entity")
	}
	if v.Id != 4503599630022047 || v.Name != "地域磨菇" || v.RaceId != 10002 {
		t.Fatalf("head = %d/%q/%d, want 4503599630022047/地域磨菇/10002", v.Id, v.Name, v.RaceId)
	}
	if len(v.CharacterConditionMap) != 3 {
		t.Fatalf("conditions = %d, want 3", len(v.CharacterConditionMap))
	}

	song := v.CharacterConditionMap[680]
	if song == nil {
		t.Fatal("CC 680 missing")
	}
	if len(song.Params) == 0 {
		t.Fatal("CC 680 Params is empty — the magnitudes never leave the packet")
	}
	if song.Params["MCMBAMIN"] != "32.200001" || song.Params["MCMBAMAX"] != "32.200001" {
		t.Errorf("CC 680 Params = %v, want MCMBAMIN/MCMBAMAX 32.200001", song.Params)
	}
	if song.AttackerId != 4503599629596015 {
		t.Errorf("CC 680 AttackerId = %d, want the caster", song.AttackerId)
	}

	debuff := v.CharacterConditionMap[1026]
	if debuff == nil || debuff.Params["DF"] != "206" || debuff.Params["LIFE"] != "342.25" {
		t.Errorf("CC 1026 Params = %v, want DF 206 and LIFE 342.25", debuff.Params)
	}

	short := v.CharacterConditionMap[494]
	if short == nil || short.Params["VAL"] != "2" {
		t.Errorf("CC 494 Params = %v, want VAL 2", short.Params)
	}
}

// An entity with no conditions must still parse, and its map must be empty
// rather than nil so callers can range over it unconditionally.
func TestParseEntityAppearPacketWithoutConditions(t *testing.T) {
	v, err := ParseEntityAppearPacket(entityAppearMessage(1<<52, 10002, "無狀態", 0))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if v.CharacterConditionMap == nil || len(v.CharacterConditionMap) != 0 {
		t.Fatalf("CharacterConditionMap = %v, want empty", v.CharacterConditionMap)
	}
}

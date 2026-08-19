package packet

import "testing"

func conditionEnablePacket(t *testing.T, ccId uint32, params string) *GamePacket {
	t.Helper()
	return &GamePacket{Id: 1, Op: OpcodeCharacterConditionUpdate, Msg: Message{
		NewMessageElemByte(1), NewMessageElemInt(ccId),
		NewMessageElemLong(63922323583596), NewMessageElemString(params),
		NewMessageElemLong(42),
	}}
}

func conditionDisablePacket(t *testing.T, ccId uint32) *GamePacket {
	t.Helper()
	return &GamePacket{Id: 1, Op: OpcodeCharacterConditionUpdate, Msg: Message{
		NewMessageElemByte(0), NewMessageElemInt(ccId),
	}}
}

func TestParseCharacterConditionPacketCarriesParams(t *testing.T) {
	p := conditionEnablePacket(t, 680,
		"MCMBAMIN:f:32.200001;MCMBAMAX:f:32.200001;SBT:8:63922323583596;")

	got, err := ParseCharacterConditionPacket(p)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if got.Params["MCMBAMIN"] != "32.200001" {
		t.Fatalf("MCMBAMIN = %q, want %q", got.Params["MCMBAMIN"], "32.200001")
	}
}

// A disable update has only 2 elements; reading element 3 must not panic.
func TestParseCharacterConditionPacketDisableHasNoParams(t *testing.T) {
	p := conditionDisablePacket(t, 680)
	got, err := ParseCharacterConditionPacket(p)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if len(got.Params) != 0 {
		t.Fatalf("Params = %v, want empty on a disable update", got.Params)
	}
}

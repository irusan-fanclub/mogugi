package packet

import "testing"

// The element sequence a real mob's 0x7532 carried in capture
// 2026-08-19_16-53-16, after the hit for 848.4: life dipped by one float32
// step (840) while max held.
func statUpdateMessage() Message {
	return Message{
		NewMessageElemByte(4),
		NewMessageElemInt(10), NewMessageElemInt(11),
		NewMessageElemFloat(1.5),
		NewMessageElemInt(12), NewMessageElemFloat(1),
		NewMessageElemInt(13), NewMessageElemFloat(1),
		NewMessageElemInt(14), NewMessageElemFloat(1),
		NewMessageElemInt(28), NewMessageElemFloat(698516160),
		NewMessageElemInt(30), NewMessageElemFloat(698517000),
		NewMessageElemInt(31), NewMessageElemFloat(0),
		NewMessageElemInt(29), NewMessageElemFloat(698517000),
		NewMessageElemInt(0), NewMessageElemInt(0),
		NewMessageElemInt(0), NewMessageElemInt(0),
	}
}

func TestParseStatUpdatePublicReadsLife(t *testing.T) {
	got := ParseStatUpdatePublic(&GamePacket{Msg: statUpdateMessage()})
	// Expectations round-trip through float32, exactly as the wire does —
	// 698517000 itself is not representable and lands on 698516992.
	if got[StatIdLife] != float64(float32(698516160)) {
		t.Fatalf("life = %v, want float32(698516160)", got[StatIdLife])
	}
	if got[StatIdLifeMax] != float64(float32(698517000)) {
		t.Fatalf("lifeMax = %v, want float32(698517000)", got[StatIdLifeMax])
	}
	if got[StatIdWound] != 0 {
		t.Fatalf("wound = %v, want 0", got[StatIdWound])
	}
}

func TestParseStatUpdatePublicTolerantOfShape(t *testing.T) {
	if got := ParseStatUpdatePublic(&GamePacket{}); len(got) != 0 {
		t.Fatalf("empty packet gave %v", got)
	}
	// A Bin-carrying (private, 0x7530-style) packet must not panic.
	m := Message{NewMessageElemBin([]byte{1, 2, 3})}
	if got := ParseStatUpdatePublic(&GamePacket{Msg: m}); len(got) != 0 {
		t.Fatalf("bin packet gave %v", got)
	}
}

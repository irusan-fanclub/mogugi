package packet

// Public stat update (0x7532): a leading Byte, one lone Int (a group or
// revision marker — 11 on the first packet of a burst, 10 after), then
// (Int statId, value) pairs with Float values, padded with zero Ints.
//
// Stat ids, verified against capture 2026-08-19_16-53-16 by correlating a
// mob's stream with the damage dealt to it (deltas match to within float32
// quantization at the 7e8 magnitude):
//   28 = current life (dropped 840 / 17,160 against hits of 848.4 / 17,143.1)
//   30 = max life (constant 698,517,000)
//   29 = same value as 30 every time; meaning unresolved, not exported
//   31 = wound  (matches the pet appear-string's LIFEWOUND)
const (
	StatIdLife    uint32 = 28
	StatIdLifeMax uint32 = 30
	StatIdWound   uint32 = 31
)

// ParseStatUpdatePublic returns the packet's statId -> value pairs. Values
// arrive as Int or Float; both widen to float64. Trailing zero-Int padding
// naturally parses as statId 0, which no caller reads.
func ParseStatUpdatePublic(p *GamePacket) map[uint32]float64 {
	out := map[uint32]float64{}
	i := 0
	if len(p.Msg) > 0 && p.Msg[0].Type() == MessageElemTypeByte {
		i = 1
	}
	// The lone marker Int sits before the pairs; without skipping it every
	// pair boundary shifts by one and the parse stops at the first Float.
	if i < len(p.Msg) && p.Msg[i].Type() == MessageElemTypeInt {
		i++
	}
	for ; i+1 < len(p.Msg); i += 2 {
		if p.Msg[i].Type() != MessageElemTypeInt {
			break
		}
		id := p.Msg[i].Data().(uint32)
		var v float64
		switch p.Msg[i+1].Type() {
		case MessageElemTypeFloat:
			v = float64(p.Msg[i+1].Data().(float32))
		case MessageElemTypeInt:
			v = float64(p.Msg[i+1].Data().(uint32))
		default:
			break
		}
		out[id] = v
	}
	return out
}

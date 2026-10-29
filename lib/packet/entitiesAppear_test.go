package packet

import (
	"encoding/binary"
	"testing"
)

// entitiesSubBody wraps an appear message the way 0x520D carries each entry.
func entitiesSubBody(m Message) []byte {
	b := make([]byte, 12)
	binary.BigEndian.PutUint32(b[0:], 0x520C)
	body := m.Bytes()
	b = binary.AppendUvarint(b, uint64(len(body)))
	return append(b, body...)
}

func TestParseEntitiesAppearKeepsCharactersAfterOtherKinds(t *testing.T) {
	other := []byte{1, 2, 3}
	msg := Message{
		NewMessageElemShort(4),
		NewMessageElemShort(160), NewMessageElemInt(0), NewMessageElemBin(other),
		NewMessageElemShort(16), NewMessageElemInt(0), NewMessageElemBin(entitiesSubBody(entityAppearMessage(1, 10001, "A", 0))),
		NewMessageElemShort(160), NewMessageElemInt(0), NewMessageElemBin(other),
		NewMessageElemShort(16), NewMessageElemInt(0), NewMessageElemBin(entitiesSubBody(entityAppearMessage(2, 10002, "B", 0))),
	}
	es, err := ParseEntitiesAppearPacket(&GamePacket{Msg: msg})
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for _, e := range es {
		names = append(names, e.Name)
	}
	if len(names) != 2 || names[0] != "A" || names[1] != "B" {
		t.Fatalf("parsed %v, want [A B]", names)
	}
}

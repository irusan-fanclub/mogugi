package packet

import (
	"bytes"
	"encoding/binary"
	"testing"
)

// A garbage element count must fail on the short body, not preallocate it.
func TestNewMessageHugeCountFails(t *testing.T) {
	body := binary.AppendUvarint(nil, 1<<60)
	body = append(body, 0, byte(MessageElemTypeByte), 7)
	if _, err := NewMessage(bytes.NewReader(body)); err == nil {
		t.Fatal("want error for truncated body")
	}
}

func TestParseStatUpdateHugeCount(t *testing.T) {
	msg := Message{NewMessageElemByte(4), NewMessageElemInt(0xFFFFFFFF), NewMessageElemInt(28), NewMessageElemFloat(5)}
	if st := ParseStatUpdate(msg); st[28] != 5 {
		t.Fatalf("st = %v", st)
	}
}

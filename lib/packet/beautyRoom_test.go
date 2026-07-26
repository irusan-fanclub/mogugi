package packet

import "testing"

// beautyHeader builds the 4-element 0x96CA header (byte, string, int count, long).
func beautyHeader(count uint32) Message {
	return Message{
		NewMessageElemByte(1),
		NewMessageElemString("xxxxxxxxxxxxxxxxxxxx"),
		NewMessageElemInt(count),
		NewMessageElemLong(0),
	}
}

// beautyItemElems builds one minimal item record (11-element variant).
func beautyItemElems(itemId uint32) []IMessageElem {
	info := make([]byte, 80)
	le.PutUint32(info[4:], itemId)
	le.PutUint32(info[44:], 13)
	le.PutUint32(info[48:], 2)
	return []IMessageElem{
		NewMessageElemLong(22518902041861562),
		NewMessageElemByte(2),
		NewMessageElemBin(info),
		NewMessageElemBin(make([]byte, 144)),
		NewMessageElemString(""),
		NewMessageElemString(""),
		NewMessageElemByte(0),
		NewMessageElemLong(0),
		NewMessageElemByte(0),
		NewMessageElemByte(0),
		NewMessageElemLong(0),
	}
}

func TestParseBeautyRoomPacket_Synthetic(t *testing.T) {
	msg := beautyHeader(1)
	msg = append(msg, beautyItemElems(12001)...)

	items, declared, _, err := ParseBeautyRoomPacket(msg)
	if err != nil {
		t.Fatalf("ParseBeautyRoomPacket: %v", err)
	}
	if declared != 1 {
		t.Errorf("declared = %d, want 1", declared)
	}
	if len(items) != 1 {
		t.Fatalf("got %d items, want 1", len(items))
	}
	it := items[0]
	if it.ItemID != 12001 || it.Container != "beauty" || it.Qty != 1 || it.PosX != 13 || it.PosY != 2 {
		t.Errorf("item = %+v, want id=12001 container=beauty qty=1 x=13 y=2", it)
	}
}

func TestParseBeautyRoomPacket_RejectsBadHeader(t *testing.T) {
	// Too short.
	if _, _, _, err := ParseBeautyRoomPacket(Message{NewMessageElemByte(1)}); err == nil {
		t.Error("short message: want error")
	}
	// Wrong element types (0x5209-like head must not be accepted).
	bad := Message{
		NewMessageElemByte(1),
		NewMessageElemLong(42),
		NewMessageElemInt(1),
		NewMessageElemLong(0),
	}
	if _, _, _, err := ParseBeautyRoomPacket(bad); err == nil {
		t.Error("bad header types: want error")
	}
}

func TestParseBeautyRoomPacket_RealFixture(t *testing.T) {
	msg, _ := loadFixture(t, "testdata/0x96CA_sample.json")

	items, declared, _, err := ParseBeautyRoomPacket(msg)
	if err != nil {
		t.Fatalf("ParseBeautyRoomPacket: %v", err)
	}
	if declared != 39 {
		t.Errorf("declared = %d, want 39", declared)
	}
	if len(items) != 39 {
		t.Fatalf("got %d items, want 39", len(items))
	}
	it := items[0]
	if it.ItemID != 12001 || it.Container != "beauty" || it.Qty != 1 || it.PosX != 13 || it.PosY != 2 {
		t.Errorf("item[0] = %+v, want id=12001 container=beauty qty=1 x=13 y=2", it)
	}
	wantColors := [6]uint32{0xfaae4e, 0xf31e5e, 0x8ad3d8, 0x2a96b7, 0xfab7c8, 0xfbf9d4}
	if it.Colors != wantColors {
		t.Errorf("item[0] colors = %x, want %x", it.Colors, wantColors)
	}
}

package packet

import "fmt"

// ParseBeautyRoomPacket parses the 0x96CA beauty-room list: a 4-element
// header (byte, string account-id, int declared item count, long) followed
// by item records in the 0x5209 shape, then a style-state table (ignored).
// Returned items are normalized for the item index: Container "beauty",
// Qty at least 1 (the packet carries qty 0 for beauty items). Account is the
// header's account-id string, used for account backfill.
func ParseBeautyRoomPacket(msg Message) (items []InventoryItem, declared uint32, account string, err error) {
	if len(msg) < 4 ||
		msg[0].Type() != MessageElemTypeByte ||
		msg[1].Type() != MessageElemTypeString ||
		msg[2].Type() != MessageElemTypeInt ||
		msg[3].Type() != MessageElemTypeLong {
		return nil, 0, "", fmt.Errorf("beauty room: unexpected header shape (n=%d)", len(msg))
	}
	account, _ = msg[1].Data().(string)
	declared, _ = msg[2].Data().(uint32)

	items = scanItems(msg[4:])
	for i := range items {
		items[i].Container = "beauty"
		if items[i].Qty == 0 {
			items[i].Qty = 1
		}
	}
	return items, declared, account, nil
}

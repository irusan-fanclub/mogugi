package packet

import "fmt"

// InventoryItem 是從 0x5209 inventory 抽出的單件物品。
type InventoryItem struct {
	ItemID    uint32
	Qty       uint32
	Container string // main | pet_equip | pet_bag | pet_subbag | unknown
	PosX      uint32
	PosY      uint32
}

// containerFromRecType 把 Item.Info 的 rec_type 對應到容器類別。
func containerFromRecType(rec uint32) string {
	switch rec {
	case 2:
		return "main"
	case 20:
		return "pet_equip"
	case 86:
		return "pet_bag"
	case 100, 101:
		return "pet_subbag"
	default:
		return "unknown"
	}
}

// parseItemInfo 解析 80-byte Item.Info：rec_type@0, ItemId@4, Qty@36,
// PosX@44, PosY@48（皆 uint32 LE）。
func parseItemInfo(info []byte) (InventoryItem, error) {
	if len(info) < 52 {
		return InventoryItem{}, fmt.Errorf("item info too short: %d", len(info))
	}
	return InventoryItem{
		ItemID:    le.Uint32(info[4:]),
		Qty:       le.Uint32(info[36:]),
		Container: containerFromRecType(le.Uint32(info[0:])),
		PosX:      le.Uint32(info[44:]),
		PosY:      le.Uint32(info[48:]),
	}, nil
}

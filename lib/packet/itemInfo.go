package packet

import (
	"fmt"
	"strconv"
	"strings"
)

// InventoryItem 是從 0x5209 inventory 抽出的單件物品。
type InventoryItem struct {
	ItemID    uint32
	Qty       uint32
	Container string // main | pet_equip | pet_bag | pet_subbag | unknown
	PosX      uint32
	PosY      uint32
	// EnchantPrefix / EnchantSuffix 是 OptionInfo 字串裡的賦予 id（ENPFIX /
	// ENSFIX），0 表示無。名稱對照留待後續，先原樣帶 id。
	EnchantPrefix uint32
	EnchantSuffix uint32
}

// parseOptionInfo 解析 Mabinogi item 的 OptionInfo 字串，格式為
// "KEY:type:value;KEY:type:value;..."，取出 prefix（ENPFIX）與 suffix
// （ENSFIX）賦予 id。缺鍵回 0。
func parseOptionInfo(s string) (prefix, suffix uint32) {
	for _, tok := range strings.Split(s, ";") {
		if tok == "" {
			continue
		}
		parts := strings.SplitN(tok, ":", 3)
		if len(parts) != 3 {
			continue
		}
		switch parts[0] {
		case "ENPFIX":
			if v, err := strconv.ParseUint(parts[2], 10, 32); err == nil {
				prefix = uint32(v)
			}
		case "ENSFIX":
			if v, err := strconv.ParseUint(parts[2], 10, 32); err == nil {
				suffix = uint32(v)
			}
		}
	}
	return
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

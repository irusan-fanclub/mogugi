package packet

import (
	"fmt"
	"strconv"
	"strings"
)

// MetalwareEntry 是一條細緻工匠能力（ability id + 等級）。
type MetalwareEntry struct {
	AbilityID uint32
	Level     uint32
}

// EnchantRoll 是一條賦予效果的逐件浮動值（kind-1 40-byte 記錄）。
// 驗證樣本：杜克獵人手套（辛勤的，OptionList
// ":IsGreaterEqualSkillLv(10030,6) : SetParamOnEquip(Crit, +(1~3));"）
// → {Code:19(Crit), Value:1, CondSkill:10030, CondRank:6}，與遊戲
// tooltip「分解 等級A以上時 暴擊率 1 增加(1~3)」一致。
type EnchantRoll struct {
	Code      uint32 // 參數碼（19=Crit …）
	Value     uint32 // 抽到的實際值
	CondSkill uint32 // 條件技能 id（0=無）
	CondRank  uint32 // 條件技能等級（6=A …）
}

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
	// 道具屬性（來自擴充 Bin(144)）：耐久 ×1000、防禦、攻擊小/大傷。
	Durability    uint32
	DurabilityMax uint32
	Defense       uint32
	AttackMin     uint32
	AttackMax     uint32
	// Metalware 是細緻工匠能力清單（kind-7 的 40-byte 記錄）。
	Metalware []MetalwareEntry
	// EnchantRolls 是賦予效果的浮動值清單（kind-1 的 40-byte 記錄）。
	EnchantRolls []EnchantRoll
}

// parseExtEnchants 從 item 的擴充 Bin（Item.OptionInfo 結構，144 bytes）取
// 已附加在裝備上的賦予：接頭 u16 @60、接尾 u16 @62（LE）。非裝備該區為 0。
// 驗證樣本：杜克獵人手套（capture 1783460656）@60=0（接頭空）、
// @62=30105=辛勤的，與遊戲內「[接尾] 辛勤的」一致。
func parseExtEnchants(ext []byte) (prefix, suffix uint32) {
	if len(ext) < 64 {
		return 0, 0
	}
	return uint32(le.Uint16(ext[60:])), uint32(le.Uint16(ext[62:]))
}

// parseExtStats 從擴充 Bin 取道具屬性：耐久 u32@16、耐久上限 u32@20（皆
// ×1000）、攻擊小/大傷 u16@28/@30、防禦 u32@40。
// 驗證樣本：杜克獵人手套 耐久 8000/8000（遊戲顯示 8/8）、防禦 1；
// 堅固鐮刀（capture 1783467845）攻擊 1~7。
func parseExtStats(ext []byte, it *InventoryItem) {
	if len(ext) < 44 {
		return
	}
	it.Durability = le.Uint32(ext[16:])
	it.DurabilityMax = le.Uint32(ext[20:])
	it.AttackMin = uint32(le.Uint16(ext[28:]))
	it.AttackMax = uint32(le.Uint16(ext[30:]))
	it.Defense = le.Uint32(ext[40:])
}

// parseMetalwareBin 解析一筆物品尾隨的 40-byte 記錄；kind（u32@0）為 7 時是
// 細緻工匠能力：等級 u16@14、ability id u32@36。其他 kind 回 false。
// 驗證樣本：杜克獵人手套三條 = (4300106,8)(3500403,17)(3501002,13)，
// 與遊戲 tooltip 克諾斯之怒最小負傷率/水炮射程距離/造雨雲層範圍一致。
func parseMetalwareBin(b []byte) (MetalwareEntry, bool) {
	if len(b) < 40 || le.Uint32(b[0:]) != 7 {
		return MetalwareEntry{}, false
	}
	return MetalwareEntry{
		AbilityID: le.Uint32(b[36:]),
		Level:     uint32(le.Uint16(b[14:])),
	}, true
}

// parseEnchantRollBin 解析 kind=1 的 40-byte 記錄：賦予效果的浮動值。
// 參數碼 u16@12、實際值 u16@14、條件技能 u16@36、條件等級 u8@39
// （真實資料 @36..39 = "2e 27 00 06" → 技能 10030、等級 6=A）。
func parseEnchantRollBin(b []byte) (EnchantRoll, bool) {
	if len(b) < 40 || le.Uint32(b[0:]) != 1 {
		return EnchantRoll{}, false
	}
	return EnchantRoll{
		Code:      uint32(le.Uint16(b[12:])),
		Value:     uint32(le.Uint16(b[14:])),
		CondSkill: uint32(le.Uint16(b[36:])),
		CondRank:  uint32(b[39]),
	}, true
}

// parseOptionInfo 解析 Mabinogi item 的 OptionInfo 字串，格式為
// "KEY:type:value;KEY:type:value;..."，取出 prefix（ENPFIX）與 suffix
// （ENSFIX）賦予 id。缺鍵回 0。卷軸走這裡；裝備上已附的賦予則在擴充 Bin
// （見 parseExtEnchants），兩者由呼叫端合併。
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

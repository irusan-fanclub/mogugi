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

// EnchantEffect 是一條裝備效果行的逐件實際值（40-byte 記錄，依 kind 分類：
// 0=接頭賦予、1=接尾賦予、10=聖水/祝福）。範圍效果（如 +(50~55)）存的是
// 抽到的實際值；可為負（如 魔法攻擊力 -20）。
// 驗證樣本：日月之神服裝（capture 1783476479）接頭 消失的/接尾 軌跡 的
// 每一行 OptionList 與 kind-0/kind-1 記錄逐條對應；杜克獵人手套接尾
// 辛勤的 → kind-1 {Code:19(Crit), Value:1, CondSkill:10030(分解),
// CondRank:6(A)} = tooltip「分解 等級A以上時 暴擊率 1 增加(1~3)」。
type EnchantEffect struct {
	Code      uint32 // 參數碼（1=LifeMax,3=ManaMax,16=AttMax,19=Crit,20=Prot,22=平衡,53=魔攻,54=魔保,178=人偶傷害…）
	Value     int32  // 實際值（i16，可負）
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
	// 道具屬性（來自擴充 Bin(144)）：耐久 ×1000、防禦、保護、攻擊小/大傷。
	Durability    uint32
	DurabilityMax uint32
	Defense       uint32
	Protection    uint32
	AttackMin     uint32
	AttackMax     uint32
	InjuryMin     uint32
	InjuryMax     uint32
	Balance       uint32
	Critical      uint32
	// Colors 是六個染色部位 A-F（Bin80 @8/12/16/24/28/32，低 24 bit =
	// 0xRRGGBB；日月之神服裝六色與 tooltip RGB 逐一對上）。
	Colors [6]uint32
	// Metalware 是細緻工匠能力清單（kind-7 的 40-byte 記錄）。
	Metalware []MetalwareEntry
	// 效果行實際值（40-byte 記錄）：kind-0 接頭賦予 / kind-1 接尾賦予 /
	// kind-10 聖水（祝福）。
	PrefixEffects []EnchantEffect
	SuffixEffects []EnchantEffect
	BlessEffects  []EnchantEffect
	// Metadata 是 MetaData1 原始 KV 字串（MDEF/MPROT/OWNER/IMRBV/HOWA…），
	// 由前端解讀已知 key，保持前向相容。
	Metadata string
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
// ×1000）、攻擊小/大傷 u16@28/@30、負傷率小/大 u16@32/@34、平衡 u8@36、
// 暴擊率 u8@37、防禦 u32@40、保護 u32@44。
// 驗證樣本：杜克獵人手套 耐久 8/8、防禦 1、保護 0；堅固鐮刀 攻擊 1~7；
// 日月之神服裝 防禦 27 保護 19；靈魂解放者單手劍 攻擊 201~255（+聚能25=
// 遊戲顯示 226~280）、負傷率 20~35%、平衡 69、暴擊 28。
func parseExtStats(ext []byte, it *InventoryItem) {
	if len(ext) < 48 {
		return
	}
	it.Durability = le.Uint32(ext[16:])
	it.DurabilityMax = le.Uint32(ext[20:])
	it.AttackMin = uint32(le.Uint16(ext[28:]))
	it.AttackMax = uint32(le.Uint16(ext[30:]))
	it.InjuryMin = uint32(le.Uint16(ext[32:]))
	it.InjuryMax = uint32(le.Uint16(ext[34:]))
	it.Balance = uint32(ext[36])
	it.Critical = uint32(ext[37])
	it.Defense = le.Uint32(ext[40:])
	it.Protection = le.Uint32(ext[44:])
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

// parseEffectBin 解析 kind=0/1/10 的 40-byte 記錄（裝備效果行實際值）。
// 參數碼 u16@12、實際值 i16@14、條件技能 u16@36、條件等級 u8@39
// （真實資料 @36..39 = "2e 27 00 06" → 技能 10030、等級 6=A）。
// 回傳 kind 供呼叫端分路（0=接頭、1=接尾、10=聖水）。
func parseEffectBin(b []byte) (kind uint32, e EnchantEffect, ok bool) {
	if len(b) < 40 {
		return 0, EnchantEffect{}, false
	}
	kind = le.Uint32(b[0:])
	if kind != 0 && kind != 1 && kind != 10 {
		return kind, EnchantEffect{}, false
	}
	e = EnchantEffect{
		Code:      uint32(le.Uint16(b[12:])),
		Value:     int32(int16(le.Uint16(b[14:]))),
		CondSkill: uint32(le.Uint16(b[36:])),
		CondRank:  uint32(b[39]),
	}
	// 全零記錄（padding / 未知）不當效果行。
	if e.Code == 0 && e.Value == 0 && e.CondSkill == 0 {
		return kind, EnchantEffect{}, false
	}
	return kind, e, true
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

// containerFromRecType 把 Item.Info @0 的 pocket id 對應到容器類別。
// 角色本體快照（2582 件，capture 1783476479）顯示這不是小 enum 而是
// pocket/袋子 id：2=主背包、個位數小值=穿戴中的裝備欄（5=衣服…）、
// 大值=各個袋子（每個袋子一個 id）。寵物快照的 20/86/100/101 沿用舊名。
func containerFromRecType(rec uint32) string {
	switch {
	case rec == 2:
		return "main"
	case rec == 20:
		return "pet_equip"
	case rec == 86:
		return "pet_bag"
	case rec == 100 || rec == 101:
		return "pet_subbag"
	case rec >= 3 && rec <= 40:
		return "equip" // 穿戴中裝備欄位
	default:
		return "bag" // 擴充袋（pocket id 每袋不同）
	}
}

// parseItemInfo 解析 80-byte Item.Info：pocket@0, ItemId@4, Qty@36,
// PosX@44, PosY@48（皆 uint32 LE），染色部位 A-F @8/12/16/24/28/32
// （日月之神服裝六色與 tooltip 道具顏色逐一對上；高位 byte 為染色 flag，
// 取低 24 bit = 0xBBGGRR）。
func parseItemInfo(info []byte) (InventoryItem, error) {
	if len(info) < 52 {
		return InventoryItem{}, fmt.Errorf("item info too short: %d", len(info))
	}
	it := InventoryItem{
		ItemID:    le.Uint32(info[4:]),
		Qty:       le.Uint32(info[36:]),
		Container: containerFromRecType(le.Uint32(info[0:])),
		PosX:      le.Uint32(info[44:]),
		PosY:      le.Uint32(info[48:]),
	}
	for i, off := range [6]int{8, 12, 16, 24, 28, 32} {
		it.Colors[i] = le.Uint32(info[off:]) & 0x00ffffff
	}
	return it, nil
}

package packet

import "strings"

// EntitySnapshot 是從 0x5209 抽出的實體背包快照。
type EntitySnapshot struct {
	Name   string
	Master string
	Items  []InventoryItem
}

// petPropsMarker 是寵物屬性 KV 字串中固定出現的鍵；Master.Name 是緊鄰其前
// 的那個 String element。自己角色沒有這個字串，故 master 留空。
const petPropsMarker = "PET_AI:"

// ParseEntitySnapshot 走訪 0x5209 的 element list，抽出實體名、飼主名與物品清單。
//   - Name：第一個 String element（段 A creature.Name）。
//   - Master：含 petPropsMarker 的寵物屬性字串的前一個 String element。
//   - Items：掃描連續 Long → Byte(2 Private) → Bin(>=80) 視為一筆 item entry，
//     對其 Bin 套 parseItemInfo。緊接的結構為 Bin(80) → Bin(144) → String
//     （OptionInfo，含 ENPFIX/ENSFIX 賦予）；若存在則一併解析。
func ParseEntitySnapshot(msg Message) (*EntitySnapshot, error) {
	snap := &EntitySnapshot{Items: []InventoryItem{}}

	for _, e := range msg {
		if e.Type() == MessageElemTypeString {
			snap.Name, _ = e.Data().(string)
			break
		}
	}

	prevStr := ""
	for _, e := range msg {
		if e.Type() != MessageElemTypeString {
			continue
		}
		s, _ := e.Data().(string)
		if strings.Contains(s, petPropsMarker) {
			snap.Master = prevStr
			break
		}
		prevStr = s
	}

	for i := 0; i+2 < len(msg); i++ {
		if msg[i].Type() != MessageElemTypeLong {
			continue
		}
		if msg[i+1].Type() != MessageElemTypeByte {
			continue
		}
		if b, ok := msg[i+1].Data().(uint8); !ok || b != 2 {
			continue
		}
		if msg[i+2].Type() != MessageElemTypeBin {
			continue
		}
		info, ok := msg[i+2].Data().([]byte)
		if !ok || len(info) < 52 {
			continue
		}
		it, err := parseItemInfo(info)
		if err != nil {
			continue
		}
		// 賦予有兩個來源：擴充 Bin(144)@i+3 存「裝備上已附加」的賦予，
		// OptionInfo 字串@i+4 存「卷軸將給予」的賦予（ENPFIX/ENSFIX）。
		// 逐槽合併，字串優先。型別/邊界不符則視為無賦予。
		if i+3 < len(msg) && msg[i+3].Type() == MessageElemTypeBin {
			if ext, ok := msg[i+3].Data().([]byte); ok {
				it.EnchantPrefix, it.EnchantSuffix = parseExtEnchants(ext)
			}
			if i+4 < len(msg) && msg[i+4].Type() == MessageElemTypeString {
				if s, ok := msg[i+4].Data().(string); ok {
					p, sfx := parseOptionInfo(s)
					if p != 0 {
						it.EnchantPrefix = p
					}
					if sfx != 0 {
						it.EnchantSuffix = sfx
					}
				}
			}
		}
		snap.Items = append(snap.Items, it)
	}

	return snap, nil
}

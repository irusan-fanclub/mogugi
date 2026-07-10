package packet

import "strings"

// EntitySnapshot is an entity's inventory snapshot extracted from 0x5209.
type EntitySnapshot struct {
	Name   string
	Master string
	Items  []InventoryItem
}

// petPropsMarker is a key that always appears in a pet's props KV string;
// Master.Name is the String element right before it. The player's own
// character lacks this string, so master stays empty.
const petPropsMarker = "PET_AI:"

// ParseEntitySnapshot walks the 0x5209 element list, extracting entity
// name, master name and item list.
//   - Name: first String element (creature.Name).
//   - Master: the String element before the pet-props string (petPropsMarker).
//   - Items: a run of Long -> Byte(2 Private) -> Bin(>=80) is one item entry;
//     parseItemInfo is applied to its Bin. Followed by Bin(80) -> Bin(144) ->
//     String (OptionInfo with ENPFIX/ENSFIX enchants), parsed when present.
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
		// Enchants come from two sources: ext Bin(144)@i+3 holds enchants
		// already applied to the equipment; OptionInfo string@i+4 holds
		// scroll-granted enchants (ENPFIX/ENSFIX). Merge per slot, string
		// wins. Type/bounds mismatch means no enchant.
		if i+3 < len(msg) && msg[i+3].Type() == MessageElemTypeBin {
			if ext, ok := msg[i+3].Data().([]byte); ok {
				it.EnchantPrefix, it.EnchantSuffix = parseExtEnchants(ext)
				parseExtStats(ext, &it)
			}
			if i+4 < len(msg) && msg[i+4].Type() == MessageElemTypeString {
				if s, ok := msg[i+4].Data().(string); ok {
					it.Metadata = s
					p, sfx := parseOptionInfo(s)
					if p != 0 {
						it.EnchantPrefix = p
					}
					if sfx != 0 {
						it.EnchantSuffix = sfx
					}
				}
			}
			// After the two strings: Byte(count) + count x Bin(40)
			// (Aura upgradeEffect): kind=7 metalware, kind=0 prefix effect
			// line, kind=1 suffix effect line, kind=10 bless effect.
			if i+6 < len(msg) && msg[i+5].Type() == MessageElemTypeString && msg[i+6].Type() == MessageElemTypeByte {
				if cnt, ok := msg[i+6].Data().(uint8); ok {
					for k := 0; k < int(cnt) && i+7+k < len(msg); k++ {
						if msg[i+7+k].Type() != MessageElemTypeBin {
							break
						}
						b, ok := msg[i+7+k].Data().([]byte)
						if !ok {
							break
						}
						if mw, ok := parseMetalwareBin(b); ok {
							it.Metalware = append(it.Metalware, mw)
							continue
						}
						if kind, eff, ok := parseEffectBin(b); ok {
							switch kind {
							case 0:
								it.PrefixEffects = append(it.PrefixEffects, eff)
							case 1:
								it.SuffixEffects = append(it.SuffixEffects, eff)
							case 10:
								it.BlessEffects = append(it.BlessEffects, eff)
							case 11:
								it.RelicEffects = append(it.RelicEffects, eff)
							}
						}
					}
				}
			}
		}
		snap.Items = append(snap.Items, it)
	}

	// Bag backfill: a bag item's Bin144 u32@12 = its content pocket
	// (verified: festival-outfit bag->102, starlight bag->138). The IBOR
	// key identifies "this is a bag", avoiding false matches from other
	// items' leftover @12 values.
	bagByPocket := map[uint32]uint32{}
	for _, it := range snap.Items {
		if _, isBag := metaIntValue(it.Metadata, "IBOR"); isBag && it.bagContentPocket != 0 {
			bagByPocket[it.bagContentPocket] = it.ItemID
		}
	}
	for i := range snap.Items {
		if id, ok := bagByPocket[snap.Items[i].Pocket]; ok {
			snap.Items[i].BagItemID = id
		}
	}

	return snap, nil
}

package packet

import (
	"fmt"
	"strconv"
	"strings"
)

// MetalwareEntry is one metalware ability (ability id + level).
type MetalwareEntry struct {
	AbilityID uint32
	Level     uint32
}

// EnchantEffect is the rolled actual value of one equipment effect line
// (40-byte record, classified by kind: 0=prefix, 1=suffix, 10=bless).
// Range effects (e.g. +(50~55)) store the rolled value; may be negative
// (e.g. magic attack -20).
type EnchantEffect struct {
	Code      uint32 // param code (1=LifeMax,3=ManaMax,16=AttMax,19=Crit,20=Prot,22=Balance,53=MagAtt,54=MagProt,178=puppet dmg...)
	Value     int32  // actual value (i16, may be negative)
	CondSkill uint32 // condition skill id (0=none)
	CondRank  uint32 // condition skill rank (6=A ...)
}

// InventoryItem is one item extracted from the 0x5209 inventory.
type InventoryItem struct {
	ItemID    uint32
	Qty       uint32
	Container string // main | equip | bag | pet_* | unknown
	Pocket    uint32 // raw pocket id from Item.Info @0
	// BagItemID is the item id of the bag this item sits in (0=not in a
	// user bag). Rule (measured): a bag item's own OptionInfo(Bin144)
	// u32@12 = its content pocket (festival bag->102, starlight bag->138;
	// non-bag items have 0 here).
	BagItemID uint32
	// bagContentPocket is the content pocket a bag provides (Bin144 u32@12),
	// used only for snapshot post-processing pairing, not output.
	bagContentPocket uint32
	PosX             uint32
	PosY             uint32
	// EnchantPrefix / EnchantSuffix are the enchant ids from the OptionInfo
	// string (ENPFIX / ENSFIX), 0=none. Name lookup is deferred; id as-is.
	EnchantPrefix uint32
	EnchantSuffix uint32
	// Item stats (from ext Bin(144)): durability x1000, defense, protection,
	// attack min/max.
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
	// Colors are the six dye slots A-F (Bin80 @8/12/16/24/28/32, low 24 bits
	// = 0xRRGGBB).
	Colors [6]uint32
	// Metalware is the metalware ability list (kind-7 40-byte records).
	Metalware []MetalwareEntry
	// Effect-line actual values (40-byte records): kind-0 prefix / kind-1
	// suffix / kind-10 bless / kind-11 relic.
	PrefixEffects []EnchantEffect
	SuffixEffects []EnchantEffect
	BlessEffects  []EnchantEffect
	RelicEffects  []EnchantEffect
	// Metadata is the raw MetaData1 KV string (MDEF/MPROT/OWNER/IMRBV/HOWA...);
	// the frontend interprets known keys, kept for forward compatibility.
	Metadata string
}

// parseExtEnchants reads the enchants already applied to equipment from an
// item's ext Bin (Item.OptionInfo, 144 bytes): prefix u16 @60, suffix u16
// @62 (LE). Zero for non-equipment.
func parseExtEnchants(ext []byte) (prefix, suffix uint32) {
	if len(ext) < 64 {
		return 0, 0
	}
	return uint32(le.Uint16(ext[60:])), uint32(le.Uint16(ext[62:]))
}

// parseExtStats reads item stats from the ext Bin: durability u32@16,
// durability max u32@20 (both x1000), attack min/max u16@28/@30, injury
// min/max u16@32/@34, balance u8@36, critical u8@37, defense u32@40,
// protection u32@44.
func parseExtStats(ext []byte, it *InventoryItem) {
	if len(ext) < 48 {
		return
	}
	it.bagContentPocket = le.Uint32(ext[12:])
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

// parseMetalwareBin parses a 40-byte record trailing an item; when kind
// (u32@0) is 7 it is a metalware ability: level u16@14, ability id u32@36.
// Other kinds return false.
func parseMetalwareBin(b []byte) (MetalwareEntry, bool) {
	if len(b) < 40 || le.Uint32(b[0:]) != 7 {
		return MetalwareEntry{}, false
	}
	return MetalwareEntry{
		AbilityID: le.Uint32(b[36:]),
		Level:     uint32(le.Uint16(b[14:])),
	}, true
}

// parseEffectBin parses a kind=0/1/10/11 40-byte record (equipment effect
// line actual value): param code u16@12, value i16@14, condition skill
// u16@36, condition rank u8@39. Returns kind for caller routing (0=prefix,
// 1=suffix, 10=bless, 11=relic).
func parseEffectBin(b []byte) (kind uint32, e EnchantEffect, ok bool) {
	if len(b) < 40 {
		return 0, EnchantEffect{}, false
	}
	kind = le.Uint32(b[0:])
	if kind != 0 && kind != 1 && kind != 10 && kind != 11 {
		return kind, EnchantEffect{}, false
	}
	e = EnchantEffect{
		Code:      uint32(le.Uint16(b[12:])),
		Value:     int32(int16(le.Uint16(b[14:]))),
		CondSkill: uint32(le.Uint16(b[36:])),
		CondRank:  uint32(b[39]),
	}
	// All-zero record (padding / unknown) is not an effect line.
	if e.Code == 0 && e.Value == 0 && e.CondSkill == 0 {
		return kind, EnchantEffect{}, false
	}
	return kind, e, true
}

// metaIntValue reads a key's integer value from a MetaData1 KV string
// ("KEY:type:value;").
func metaIntValue(meta, key string) (int64, bool) {
	for _, tok := range strings.Split(meta, ";") {
		parts := strings.SplitN(tok, ":", 3)
		if len(parts) == 3 && parts[0] == key {
			if v, err := strconv.ParseInt(parts[2], 10, 64); err == nil {
				return v, true
			}
		}
	}
	return 0, false
}

// parseOptionInfo parses a Mabinogi item's OptionInfo string
// ("KEY:type:value;KEY:type:value;...") for the prefix (ENPFIX) and suffix
// (ENSFIX) enchant ids. Missing key returns 0. Scrolls use this; enchants
// already applied to equipment live in the ext Bin (see parseExtEnchants),
// merged by the caller.
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

// containerFromRecType maps the pocket id from Item.Info @0 to a container
// class. It is not a small enum but a pocket/bag id: 2=main, small values=
// worn equipment slots (5=clothes...), large values=individual bags (one id
// each). Pet snapshot ids 20/86/100/101 keep their legacy names.
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
	case rec == 23:
		return "quest" // quest tab
	case rec >= 3 && rec <= 22:
		return "equip" // worn equipment slot
	default:
		return "bag" // expansion bag or system tab (pocket id differs per bag)
	}
}

// parseItemInfo parses 80-byte Item.Info: pocket@0, ItemId@4, Qty@36,
// PosX@44, PosY@48 (all uint32 LE), dye slots A-F @8/12/16/24/28/32 (high
// byte is a dye flag; take low 24 bits = 0xRRGGBB).
func parseItemInfo(info []byte) (InventoryItem, error) {
	if len(info) < 52 {
		return InventoryItem{}, fmt.Errorf("item info too short: %d", len(info))
	}
	pocket := le.Uint32(info[0:])
	it := InventoryItem{
		ItemID:    le.Uint32(info[4:]),
		Qty:       le.Uint32(info[36:]),
		Container: containerFromRecType(pocket),
		Pocket:    pocket,
		PosX:      le.Uint32(info[44:]),
		PosY:      le.Uint32(info[48:]),
	}
	for i, off := range [6]int{8, 12, 16, 24, 28, 32} {
		it.Colors[i] = le.Uint32(info[off:]) & 0x00ffffff
	}
	return it, nil
}

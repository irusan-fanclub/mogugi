package main

import (
	"encoding/csv"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/irusan-fanclub/mabidilmeter/lib/packet"
	"github.com/irusan-fanclub/mabidilmeter/lib/util"
)

var itemLogger = util.NewLogger("itemlog")

// itemsLogDirPath is the output dir for item-index CSVs, alongside logs/
// (relative to the working dir). A variable so tests can override it.
var itemsLogDirPath = "items_log"

// IndexItem / IndexEntity are the aggregation models for /api/item-index.
// IndexMetalware is one metalware ability (for JSON).
type IndexMetalware struct {
	ID    uint32 `json:"id"`
	Level uint32 `json:"level"`
}

// IndexEnchantEffect is one effect-line actual value (for JSON).
type IndexEnchantEffect struct {
	Code      uint32 `json:"code"`
	Value     int32  `json:"value"`
	CondSkill uint32 `json:"condSkill,omitempty"`
	CondRank  uint32 `json:"condRank,omitempty"`
}

type IndexItem struct {
	ID            uint32               `json:"id"`
	Qty           uint32               `json:"qty"`
	Container     string               `json:"container"`
	X             uint32               `json:"x"`
	Y             uint32               `json:"y"`
	EnchantPrefix uint32               `json:"enchantPrefix,omitempty"`
	EnchantSuffix uint32               `json:"enchantSuffix,omitempty"`
	Durability    uint32               `json:"durability,omitempty"`
	DurabilityMax uint32               `json:"durabilityMax,omitempty"`
	Defense       uint32               `json:"defense,omitempty"`
	AttackMin     uint32               `json:"attackMin,omitempty"`
	Protection    uint32               `json:"protection,omitempty"`
	InjuryMin     uint32               `json:"injuryMin,omitempty"`
	InjuryMax     uint32               `json:"injuryMax,omitempty"`
	Balance       uint32               `json:"balance,omitempty"`
	Critical      uint32               `json:"critical,omitempty"`
	BagItemID     uint32               `json:"bagItemId,omitempty"`
	Pocket        uint32               `json:"pocket,omitempty"`
	AttackMax     uint32               `json:"attackMax,omitempty"`
	Metalware     []IndexMetalware     `json:"metalware,omitempty"`
	PrefixEffects []IndexEnchantEffect `json:"prefixEffects,omitempty"`
	SuffixEffects []IndexEnchantEffect `json:"suffixEffects,omitempty"`
	BlessEffects  []IndexEnchantEffect `json:"blessEffects,omitempty"`
	RelicEffects  []IndexEnchantEffect `json:"relicEffects,omitempty"`
	Colors        []string             `json:"colors,omitempty"`   // six 0xRRGGBB hex colors (omitted if all 0)
	Metadata      string               `json:"metadata,omitempty"` // raw MetaData1 KV
}

// encodeMetalware / decodeMetalware store metalware in one CSV column as
// "id:lv|id:lv".
func encodeMetalware(list []packet.MetalwareEntry) string {
	parts := make([]string, 0, len(list))
	for _, m := range list {
		parts = append(parts, fmt.Sprintf("%d:%d", m.AbilityID, m.Level))
	}
	return strings.Join(parts, "|")
}

func decodeMetalware(s string) []IndexMetalware {
	if s == "" {
		return nil
	}
	var out []IndexMetalware
	for _, part := range strings.Split(s, "|") {
		id, lv, ok := strings.Cut(part, ":")
		if !ok {
			continue
		}
		idU, err1 := strconv.ParseUint(id, 10, 32)
		lvU, err2 := strconv.ParseUint(lv, 10, 32)
		if err1 != nil || err2 != nil {
			continue
		}
		out = append(out, IndexMetalware{ID: uint32(idU), Level: uint32(lvU)})
	}
	return out
}

// encodeEffects / decodeEffects store effects in one CSV column as
// "code:value:condSkill:condRank|..." (value may be negative).
func encodeEffects(list []packet.EnchantEffect) string {
	parts := make([]string, 0, len(list))
	for _, r := range list {
		parts = append(parts, fmt.Sprintf("%d:%d:%d:%d", r.Code, r.Value, r.CondSkill, r.CondRank))
	}
	return strings.Join(parts, "|")
}

func decodeEffects(s string) []IndexEnchantEffect {
	if s == "" {
		return nil
	}
	var out []IndexEnchantEffect
	for _, part := range strings.Split(s, "|") {
		f := strings.Split(part, ":")
		if len(f) != 4 {
			continue
		}
		code, err1 := strconv.ParseUint(f[0], 10, 32)
		val, err2 := strconv.ParseInt(f[1], 10, 32)
		skill, err3 := strconv.ParseUint(f[2], 10, 32)
		rank, err4 := strconv.ParseUint(f[3], 10, 32)
		if err1 != nil || err2 != nil || err3 != nil || err4 != nil {
			continue
		}
		out = append(out, IndexEnchantEffect{
			Code: uint32(code), Value: int32(val),
			CondSkill: uint32(skill), CondRank: uint32(rank),
		})
	}
	return out
}

// encodeColors / decodeColors store colors in one CSV column as "rrggbb|..."
// (6 hex segments); all-0 (no dye data) returns an empty string.
func encodeColors(c [6]uint32) string {
	any := false
	for _, v := range c {
		if v != 0 {
			any = true
			break
		}
	}
	if !any {
		return ""
	}
	parts := make([]string, 6)
	for i, v := range c {
		parts[i] = fmt.Sprintf("%06x", v)
	}
	return strings.Join(parts, "|")
}

func decodeColors(s string) []string {
	if s == "" {
		return nil
	}
	return strings.Split(s, "|")
}

type IndexEntity struct {
	Entity string      `json:"entity"`
	Master string      `json:"master"`
	Items  []IndexItem `json:"items"`
}

// windowsReserved lists Windows reserved device names, which fail as
// filenames (case-insensitive).
var windowsReserved = map[string]bool{
	"con": true, "prn": true, "aux": true, "nul": true,
	"com1": true, "com2": true, "com3": true, "com4": true, "com5": true,
	"com6": true, "com7": true, "com8": true, "com9": true,
	"lpt1": true, "lpt2": true, "lpt3": true, "lpt4": true, "lpt5": true,
	"lpt6": true, "lpt7": true, "lpt8": true, "lpt9": true,
}

// sanitizeEntityName turns an entity name into a safe filename (keeps CJK,
// removes illegal chars, trims whitespace and trailing dots, avoids Windows
// reserved device names).
func sanitizeEntityName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "_unnamed"
	}
	var b strings.Builder
	for _, r := range name {
		switch r {
		case '/', '\\', ':', '*', '?', '"', '<', '>', '|':
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}
	// Windows ignores trailing '.' and spaces in filenames; strip them so
	// names still match.
	out := strings.TrimRight(strings.TrimSpace(b.String()), ". ")
	if out == "" {
		return "_unnamed"
	}
	if windowsReserved[strings.ToLower(out)] {
		out = "_" + out
	}
	return out
}

// itemsLogDir returns the item-index output dir (alongside logs/).
func itemsLogDir() (string, error) {
	return itemsLogDirPath, nil
}

// writeEntitySnapshot writes the snapshot to {exedir}/items_log/.
func writeEntitySnapshot(snap *packet.EntitySnapshot) error {
	dir, err := itemsLogDir()
	if err != nil {
		return err
	}
	return writeEntityCSVTo(dir, snap)
}

// writeEntityCSVTo atomically overwrites dir/{sanitize(name)}.csv. First row
// is the master comment, second is the header, then one row per item.
func writeEntityCSVTo(dir string, snap *packet.EntitySnapshot) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	// Entity names are unique (characters/pets never collide), so the name
	// alone works as the filename; the true (unsanitized) name is kept in
	// the # meta row to avoid loss from sanitization.
	final := filepath.Join(dir, sanitizeEntityName(snap.Name)+".csv")
	tmp, err := os.CreateTemp(dir, ".tmp-*.csv")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	w := csv.NewWriter(tmp)
	// The # meta row carries both entity and master name, decoupling display
	// name from filename (the filename includes the master name to avoid
	// same-named pets overwriting each other, but the display name should be
	// the entity's own name).
	_ = w.Write([]string{"# meta", snap.Name, snap.Master})
	_ = w.Write([]string{"item_id", "qty", "container", "pos_x", "pos_y", "enchant_prefix", "enchant_suffix",
		"durability", "durability_max", "defense", "attack_min", "attack_max", "metalware", "suffix_effects",
		"prefix_effects", "bless_effects", "protection", "colors", "metadata", "injury_min", "injury_max", "balance", "critical", "bag_item_id", "pocket", "relic_effects"})
	for _, it := range snap.Items {
		_ = w.Write([]string{
			strconv.FormatUint(uint64(it.ItemID), 10),
			strconv.FormatUint(uint64(it.Qty), 10),
			it.Container,
			strconv.FormatUint(uint64(it.PosX), 10),
			strconv.FormatUint(uint64(it.PosY), 10),
			strconv.FormatUint(uint64(it.EnchantPrefix), 10),
			strconv.FormatUint(uint64(it.EnchantSuffix), 10),
			strconv.FormatUint(uint64(it.Durability), 10),
			strconv.FormatUint(uint64(it.DurabilityMax), 10),
			strconv.FormatUint(uint64(it.Defense), 10),
			strconv.FormatUint(uint64(it.AttackMin), 10),
			strconv.FormatUint(uint64(it.AttackMax), 10),
			encodeMetalware(it.Metalware),
			encodeEffects(it.SuffixEffects),
			encodeEffects(it.PrefixEffects),
			encodeEffects(it.BlessEffects),
			strconv.FormatUint(uint64(it.Protection), 10),
			encodeColors(it.Colors),
			it.Metadata,
			strconv.FormatUint(uint64(it.InjuryMin), 10),
			strconv.FormatUint(uint64(it.InjuryMax), 10),
			strconv.FormatUint(uint64(it.Balance), 10),
			strconv.FormatUint(uint64(it.Critical), 10),
			strconv.FormatUint(uint64(it.BagItemID), 10),
			strconv.FormatUint(uint64(it.Pocket), 10),
			encodeEffects(it.RelicEffects),
		})
	}
	w.Flush()
	if err := w.Error(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpName, final) // atomic overwrite
}

// readItemIndexFrom reads all .csv under dir and returns the aggregation
// (sorted by entity name).
func readItemIndexFrom(dir string) ([]IndexEntity, error) {
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return []IndexEntity{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []IndexEntity{}
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".csv" {
			continue
		}
		ent, err := readOneEntityCSV(filepath.Join(dir, e.Name()))
		if err != nil {
			itemLogger.Printf("skip %s: %v", e.Name(), err)
			continue
		}
		out = append(out, ent)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Entity < out[j].Entity })
	return out, nil
}

func readOneEntityCSV(path string) (IndexEntity, error) {
	f, err := os.Open(path)
	if err != nil {
		return IndexEntity{}, err
	}
	defer f.Close()

	r := csv.NewReader(f)
	r.FieldsPerRecord = -1
	rows, err := r.ReadAll()
	if err != nil {
		return IndexEntity{}, err
	}
	ent := IndexEntity{
		Entity: trimCSVExt(filepath.Base(path)),
		Items:  []IndexItem{},
	}
	for _, row := range rows {
		// New format: # meta,<entity>,<master>; legacy: # master,<master>
		// (name comes from the filename).
		if len(row) >= 3 && row[0] == "# meta" {
			ent.Entity = row[1]
			ent.Master = row[2]
			continue
		}
		if len(row) == 2 && row[0] == "# master" {
			ent.Master = row[1]
			continue
		}
		if len(row) < 5 || row[0] == "item_id" {
			continue
		}
		id, err := strconv.ParseUint(row[0], 10, 32)
		if err != nil {
			continue
		}
		qty, _ := strconv.ParseUint(row[1], 10, 32)
		x, _ := strconv.ParseUint(row[3], 10, 32)
		y, _ := strconv.ParseUint(row[4], 10, 32)
		item := IndexItem{
			ID: uint32(id), Qty: uint32(qty), Container: row[2], X: uint32(x), Y: uint32(y),
		}
		// The following columns were added later; when an old CSV has fewer
		// columns, missing fields default to 0.
		if len(row) >= 7 {
			ep, _ := strconv.ParseUint(row[5], 10, 32)
			es, _ := strconv.ParseUint(row[6], 10, 32)
			item.EnchantPrefix = uint32(ep)
			item.EnchantSuffix = uint32(es)
		}
		if len(row) >= 13 {
			dur, _ := strconv.ParseUint(row[7], 10, 32)
			durMax, _ := strconv.ParseUint(row[8], 10, 32)
			def, _ := strconv.ParseUint(row[9], 10, 32)
			aMin, _ := strconv.ParseUint(row[10], 10, 32)
			aMax, _ := strconv.ParseUint(row[11], 10, 32)
			item.Durability = uint32(dur)
			item.DurabilityMax = uint32(durMax)
			item.Defense = uint32(def)
			item.AttackMin = uint32(aMin)
			item.AttackMax = uint32(aMax)
			item.Metalware = decodeMetalware(row[12])
		}
		if len(row) >= 14 {
			item.SuffixEffects = decodeEffects(row[13])
		}
		if len(row) >= 19 {
			item.PrefixEffects = decodeEffects(row[14])
			item.BlessEffects = decodeEffects(row[15])
			prot, _ := strconv.ParseUint(row[16], 10, 32)
			item.Protection = uint32(prot)
			item.Colors = decodeColors(row[17])
			item.Metadata = row[18]
		}
		if len(row) >= 23 {
			imin, _ := strconv.ParseUint(row[19], 10, 32)
			imax, _ := strconv.ParseUint(row[20], 10, 32)
			bal, _ := strconv.ParseUint(row[21], 10, 32)
			crit, _ := strconv.ParseUint(row[22], 10, 32)
			item.InjuryMin = uint32(imin)
			item.InjuryMax = uint32(imax)
			item.Balance = uint32(bal)
			item.Critical = uint32(crit)
		}
		if len(row) >= 24 {
			bid, _ := strconv.ParseUint(row[23], 10, 32)
			item.BagItemID = uint32(bid)
		}
		if len(row) >= 25 {
			pk, _ := strconv.ParseUint(row[24], 10, 32)
			item.Pocket = uint32(pk)
		}
		if len(row) >= 26 {
			item.RelicEffects = decodeEffects(row[25])
		}
		ent.Items = append(ent.Items, item)
	}
	return ent, nil
}

func trimCSVExt(base string) string {
	return base[:len(base)-len(filepath.Ext(base))]
}

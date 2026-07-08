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
)

// itemsLogDirPath 是物品索引 CSV 的輸出目錄，與 logs/ 同層（相對工作目錄）。
// 以變數形式存在以便測試覆寫。
var itemsLogDirPath = "items_log"

// IndexItem / IndexEntity 是 /api/item-index 的聚合模型。
// IndexMetalware 是一條細緻工匠能力（JSON 用）。
type IndexMetalware struct {
	ID    uint32 `json:"id"`
	Level uint32 `json:"level"`
}

type IndexItem struct {
	ID            uint32           `json:"id"`
	Qty           uint32           `json:"qty"`
	Container     string           `json:"container"`
	X             uint32           `json:"x"`
	Y             uint32           `json:"y"`
	EnchantPrefix uint32           `json:"enchantPrefix,omitempty"`
	EnchantSuffix uint32           `json:"enchantSuffix,omitempty"`
	Durability    uint32           `json:"durability,omitempty"`
	DurabilityMax uint32           `json:"durabilityMax,omitempty"`
	Defense       uint32           `json:"defense,omitempty"`
	AttackMin     uint32           `json:"attackMin,omitempty"`
	AttackMax     uint32           `json:"attackMax,omitempty"`
	Metalware     []IndexMetalware `json:"metalware,omitempty"`
}

// encodeMetalware / decodeMetalware 以 "id:lv|id:lv" 存入 CSV 單欄。
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

type IndexEntity struct {
	Entity string      `json:"entity"`
	Master string      `json:"master"`
	Items  []IndexItem `json:"items"`
}

// sanitizeEntityName 把實體名稱轉成安全檔名（保留中文，移除非法字元，trim 空白）。
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
	return strings.TrimSpace(b.String())
}

// itemsLogDir 回傳物品索引輸出目錄（與 logs/ 同層）。
func itemsLogDir() (string, error) {
	return itemsLogDirPath, nil
}

// writeEntitySnapshot 把快照寫到 {exedir}/items_log/。
func writeEntitySnapshot(snap *packet.EntitySnapshot) error {
	dir, err := itemsLogDir()
	if err != nil {
		return err
	}
	return writeEntityCSVTo(dir, snap)
}

// writeEntityCSVTo 原子覆寫 dir/{sanitize(name)}.csv。第一列為 master 註解，
// 第二列表頭，其後每件物品一列。
func writeEntityCSVTo(dir string, snap *packet.EntitySnapshot) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	final := filepath.Join(dir, sanitizeEntityName(snap.Name)+".csv")
	tmp, err := os.CreateTemp(dir, ".tmp-*.csv")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	w := csv.NewWriter(tmp)
	_ = w.Write([]string{"# master", snap.Master})
	_ = w.Write([]string{"item_id", "qty", "container", "pos_x", "pos_y", "enchant_prefix", "enchant_suffix",
		"durability", "durability_max", "defense", "attack_min", "attack_max", "metalware"})
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
	return os.Rename(tmpName, final) // 原子覆寫
}

// readItemIndexFrom 讀 dir 下所有 .csv，回傳聚合（依 entity 名排序）。
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
			logger.Printf("item-index: skip %s: %v", e.Name(), err)
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
		// 之後的欄位皆為後加；舊 CSV 欄數不足時缺什麼補 0。
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
		ent.Items = append(ent.Items, item)
	}
	return ent, nil
}

func trimCSVExt(base string) string {
	return base[:len(base)-len(filepath.Ext(base))]
}

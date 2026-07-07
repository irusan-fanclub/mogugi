package main

import (
	"encoding/csv"
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
type IndexItem struct {
	ID            uint32 `json:"id"`
	Qty           uint32 `json:"qty"`
	Container     string `json:"container"`
	X             uint32 `json:"x"`
	Y             uint32 `json:"y"`
	EnchantPrefix uint32 `json:"enchantPrefix,omitempty"`
	EnchantSuffix uint32 `json:"enchantSuffix,omitempty"`
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
	_ = w.Write([]string{"item_id", "qty", "container", "pos_x", "pos_y", "enchant_prefix", "enchant_suffix"})
	for _, it := range snap.Items {
		_ = w.Write([]string{
			strconv.FormatUint(uint64(it.ItemID), 10),
			strconv.FormatUint(uint64(it.Qty), 10),
			it.Container,
			strconv.FormatUint(uint64(it.PosX), 10),
			strconv.FormatUint(uint64(it.PosY), 10),
			strconv.FormatUint(uint64(it.EnchantPrefix), 10),
			strconv.FormatUint(uint64(it.EnchantSuffix), 10),
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
		// 賦予欄位為後加；舊 CSV 只有 5 欄，缺就當 0。
		if len(row) >= 7 {
			ep, _ := strconv.ParseUint(row[5], 10, 32)
			es, _ := strconv.ParseUint(row[6], 10, 32)
			item.EnchantPrefix = uint32(ep)
			item.EnchantSuffix = uint32(es)
		}
		ent.Items = append(ent.Items, item)
	}
	return ent, nil
}

func trimCSVExt(base string) string {
	return base[:len(base)-len(filepath.Ext(base))]
}

package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"hash/fnv"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/packet"
	_ "modernc.org/sqlite"
)

// itemStore is the SQLite-backed item index (items_log/items.db).
// Single-writer: MaxOpenConns(1) avoids SQLITE_BUSY between handlers.
type itemStore struct {
	db *sql.DB
}

type entityMeta struct {
	Id     int64
	Name   string
	Master string
	RaceId uint32
}

const itemStoreSchema = `
CREATE TABLE IF NOT EXISTS entities (
  id         INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  master     TEXT NOT NULL DEFAULT '',
  race_id    INTEGER NOT NULL DEFAULT 0,
  account    TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS items (
  entity_id INTEGER NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  storage   TEXT NOT NULL,
  item_id INTEGER NOT NULL,
  qty INTEGER NOT NULL DEFAULT 0,
  container TEXT NOT NULL DEFAULT '',
  pos_x INTEGER NOT NULL DEFAULT 0, pos_y INTEGER NOT NULL DEFAULT 0,
  enchant_prefix INTEGER NOT NULL DEFAULT 0, enchant_suffix INTEGER NOT NULL DEFAULT 0,
  durability INTEGER NOT NULL DEFAULT 0, durability_max INTEGER NOT NULL DEFAULT 0,
  defense INTEGER NOT NULL DEFAULT 0, protection INTEGER NOT NULL DEFAULT 0,
  attack_min INTEGER NOT NULL DEFAULT 0, attack_max INTEGER NOT NULL DEFAULT 0,
  injury_min INTEGER NOT NULL DEFAULT 0, injury_max INTEGER NOT NULL DEFAULT 0,
  balance INTEGER NOT NULL DEFAULT 0, critical INTEGER NOT NULL DEFAULT 0,
  bag_item_id INTEGER NOT NULL DEFAULT 0, pocket INTEGER NOT NULL DEFAULT 0,
  bag_name TEXT NOT NULL DEFAULT '',
  colors TEXT NOT NULL DEFAULT '',
  metalware TEXT NOT NULL DEFAULT '',
  prefix_effects TEXT NOT NULL DEFAULT '',
  suffix_effects TEXT NOT NULL DEFAULT '',
  bless_effects  TEXT NOT NULL DEFAULT '',
  relic_effects  TEXT NOT NULL DEFAULT '',
  metadata TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_items_entity_storage ON items(entity_id, storage);
CREATE INDEX IF NOT EXISTS idx_items_item ON items(item_id);
`

func openItemStore(path string) (*itemStore, error) {
	// sqlite refuses to create the db file inside a missing directory; the
	// CSV writers used to MkdirAll items_log/, so this replaces that step.
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	for _, pragma := range []string{
		"PRAGMA journal_mode=WAL", "PRAGMA busy_timeout=5000", "PRAGMA foreign_keys=ON",
	} {
		if _, err := db.Exec(pragma); err != nil {
			db.Close()
			return nil, err
		}
	}
	if _, err := db.Exec(itemStoreSchema); err != nil {
		db.Close()
		return nil, err
	}
	return &itemStore{db: db}, nil
}

func (s *itemStore) Close() { _ = s.db.Close() }

// upsertEntityTx keeps a previously learned account (excluded row has '').
func upsertEntityTx(tx *sql.Tx, m entityMeta) error {
	_, err := tx.Exec(`INSERT INTO entities (id, name, master, race_id, updated_at)
		VALUES (?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
		  name=excluded.name, master=excluded.master,
		  race_id=excluded.race_id, updated_at=excluded.updated_at`,
		m.Id, m.Name, m.Master, m.RaceId, time.Now().Unix())
	return err
}

func insertItemsTx(tx *sql.Tx, entityId int64, storage, bagName string, items []packet.InventoryItem) error {
	stmt, err := tx.Prepare(`INSERT INTO items (
		entity_id, storage, item_id, qty, container, pos_x, pos_y,
		enchant_prefix, enchant_suffix, durability, durability_max,
		defense, protection, attack_min, attack_max, injury_min, injury_max,
		balance, critical, bag_item_id, pocket, bag_name, colors, metalware,
		prefix_effects, suffix_effects, bless_effects, relic_effects, metadata
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, it := range items {
		if _, err := stmt.Exec(
			entityId, storage, it.ItemID, it.Qty, it.Container, it.PosX, it.PosY,
			it.EnchantPrefix, it.EnchantSuffix, it.Durability, it.DurabilityMax,
			it.Defense, it.Protection, it.AttackMin, it.AttackMax, it.InjuryMin, it.InjuryMax,
			it.Balance, it.Critical, it.BagItemID, it.Pocket, bagName,
			encodeColors(it.Colors), encodeMetalware(it.Metalware),
			encodeEffects(it.PrefixEffects), encodeEffects(it.SuffixEffects),
			encodeEffects(it.BlessEffects), encodeEffects(it.RelicEffects), it.Metadata,
		); err != nil {
			return err
		}
	}
	return nil
}

func (s *itemStore) ReplaceStorage(meta entityMeta, storage string, items []packet.InventoryItem) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := upsertEntityTx(tx, meta); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM items WHERE entity_id=? AND storage=?`, meta.Id, storage); err != nil {
		return err
	}
	if err := insertItemsTx(tx, meta.Id, storage, "", items); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *itemStore) ReplaceBankTab(accountEntity entityMeta, bagName string, items []packet.InventoryItem) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := upsertEntityTx(tx, accountEntity); err != nil {
		return err
	}
	if _, err := tx.Exec(`DELETE FROM items WHERE entity_id=? AND storage='bank' AND bag_name=?`,
		accountEntity.Id, bagName); err != nil {
		return err
	}
	if err := insertItemsTx(tx, accountEntity.Id, "bank", bagName, items); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *itemStore) CountItems(entityId int64, storage string) (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT COUNT(*) FROM items WHERE entity_id=? AND storage=?`,
		entityId, storage).Scan(&n)
	return n, err
}

func (s *itemStore) SetAccountById(entityId int64, account string) error {
	_, err := s.db.Exec(`UPDATE entities SET account=? WHERE id=?`, account, entityId)
	return err
}

func (s *itemStore) SetAccountByNames(account string, names []string) error {
	for _, n := range names {
		if _, err := s.db.Exec(`UPDATE entities SET account=? WHERE name=?`, account, n); err != nil {
			return err
		}
	}
	return nil
}

func (s *itemStore) ReadIndex() ([]IndexEntity, error) {
	rows, err := s.db.Query(`SELECT e.id, e.name, e.master, e.account,
		i.storage, i.item_id, i.qty, i.container, i.pos_x, i.pos_y,
		i.enchant_prefix, i.enchant_suffix, i.durability, i.durability_max,
		i.defense, i.protection, i.attack_min, i.attack_max, i.injury_min, i.injury_max,
		i.balance, i.critical, i.bag_item_id, i.pocket, i.bag_name, i.colors, i.metalware,
		i.prefix_effects, i.suffix_effects, i.bless_effects, i.relic_effects, i.metadata
		FROM entities e LEFT JOIN items i ON i.entity_id = e.id
		ORDER BY e.name, i.storage, i.container, i.pos_y, i.pos_x`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byId := map[int64]*IndexEntity{}
	order := []int64{}
	for rows.Next() {
		var id int64
		var name, master, account string
		var storage, container, bagName, colors, metalware sql.NullString
		var pfx, sfx, bless, relic, metadata sql.NullString
		var itemId, qty, posX, posY, ep, es, dur, durMax sql.NullInt64
		var def, prot, aMin, aMax, iMin, iMax, bal, crit, bagId, pocket sql.NullInt64
		if err := rows.Scan(&id, &name, &master, &account,
			&storage, &itemId, &qty, &container, &posX, &posY,
			&ep, &es, &dur, &durMax, &def, &prot, &aMin, &aMax, &iMin, &iMax,
			&bal, &crit, &bagId, &pocket, &bagName, &colors, &metalware,
			&pfx, &sfx, &bless, &relic, &metadata); err != nil {
			return nil, err
		}
		ent, ok := byId[id]
		if !ok {
			ent = &IndexEntity{Entity: name, Master: master, Account: account, Items: []IndexItem{}}
			byId[id] = ent
			order = append(order, id)
		}
		if !storage.Valid {
			continue // entity without items (LEFT JOIN)
		}
		ent.Items = append(ent.Items, IndexItem{
			ID: uint32(itemId.Int64), Qty: uint32(qty.Int64),
			Storage: storage.String, Container: container.String,
			X: uint32(posX.Int64), Y: uint32(posY.Int64),
			EnchantPrefix: uint32(ep.Int64), EnchantSuffix: uint32(es.Int64),
			Durability: uint32(dur.Int64), DurabilityMax: uint32(durMax.Int64),
			Defense: uint32(def.Int64), Protection: uint32(prot.Int64),
			AttackMin: uint32(aMin.Int64), AttackMax: uint32(aMax.Int64),
			InjuryMin: uint32(iMin.Int64), InjuryMax: uint32(iMax.Int64),
			Balance: uint32(bal.Int64), Critical: uint32(crit.Int64),
			BagItemID: uint32(bagId.Int64), Pocket: uint32(pocket.Int64),
			BagName: bagName.String, Colors: decodeColors(colors.String),
			Metalware: decodeMetalware(metalware.String),
			PrefixEffects: decodeEffects(pfx.String), SuffixEffects: decodeEffects(sfx.String),
			BlessEffects: decodeEffects(bless.String), RelicEffects: decodeEffects(relic.String),
			Metadata: metadata.String,
		})
	}
	out := make([]IndexEntity, 0, len(order))
	for _, id := range order {
		out = append(out, *byId[id])
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Entity < out[j].Entity })
	return out, rows.Err()
}

// bankEntityId derives a stable synthetic (negative) entity id per account.
func bankEntityId(account string) int64 {
	h := fnv.New64a()
	_, _ = h.Write([]byte(account))
	return -int64(h.Sum64() >> 1)
}

// accountHash returns the first 6 hex chars of SHA-256(account): a stable,
// non-reversible label, so the raw account id never reaches disk or the UI.
func accountHash(account string) string {
	sum := sha256.Sum256([]byte(account))
	return hex.EncodeToString(sum[:])[:6]
}

// isAccountHash reports whether s is already an accountHash output.
func isAccountHash(s string) bool {
	if len(s) != 6 {
		return false
	}
	for _, c := range s {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}

func bankEntityName(account string) string {
	return "bank_" + accountHash(account)
}

package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

const (
	importRegistryFileName = "imported.json"
	importedNotice         = "這個檔案已匯入過戰鬥紀錄，這次不重複匯入。"
)

type importEntry struct {
	File string `json:"file"`
	At   string `json:"at"`
}

// importRegistry remembers which capture files already had their battles
// imported, keyed by sha256 of the file.
type importRegistry struct {
	mu      sync.Mutex
	path    string
	entries map[string]importEntry
	corrupt bool // on-disk file was unparseable; back it up before replacing
}

// loadImportRegistry reads the registry. A missing file is empty. A corrupt
// file yields a usable empty registry plus an error; it is left untouched
// until the first Add, which backs it up as <path>.bak.
func loadImportRegistry(path string) (*importRegistry, error) {
	r := &importRegistry{path: path, entries: map[string]importEntry{}}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return r, nil
	}
	if err != nil {
		return r, err
	}
	if err := json.Unmarshal(b, &r.entries); err != nil || r.entries == nil {
		r.entries = map[string]importEntry{}
		r.corrupt = true
		return r, fmt.Errorf("imported.json 已損毀：%v", err)
	}
	return r, nil
}

func (r *importRegistry) Has(sum string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.entries[sum]
	return ok
}

// Add records a file and persists atomically (temp file + rename).
func (r *importRegistry) Add(sum, file string, at time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.corrupt {
		if err := os.Rename(r.path, r.path+".bak"); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		r.corrupt = false
	}
	next := make(map[string]importEntry, len(r.entries)+1)
	for k, v := range r.entries {
		next[k] = v
	}
	next[sum] = importEntry{File: file, At: at.Format(time.RFC3339)}
	b, err := json.MarshalIndent(next, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(r.path), 0o755); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(r.path), importRegistryFileName+".*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	if _, err := f.Write(b); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Chmod(tmp, 0o644); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, r.path); err != nil {
		os.Remove(tmp)
		return err
	}
	r.entries = next
	return nil
}

func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// joinNotice appends add to an existing notice.
func joinNotice(cur, add string) string {
	return cur + add
}

func importRegistryPath() string {
	return filepath.Join(dungeonLogDirPath, importRegistryFileName)
}

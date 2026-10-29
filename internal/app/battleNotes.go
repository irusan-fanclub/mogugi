package app

import (
	"fmt"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sync"
)

// Battle notes live beside the records as one sidecar json (filename ->
// note); the ndjson files themselves stay append-only event streams.
var battleNotesMu sync.Mutex

func battleNotesPath() string {
	return filepath.Join(dungeonLogDirPath, "notes.json")
}

func loadBattleNotes() map[string]string {
	battleNotesMu.Lock()
	defer battleNotesMu.Unlock()
	return loadBattleNotesLocked()
}

func loadBattleNotesLocked() map[string]string {
	notes, _ := loadBattleNotesStrict()
	return notes
}

// loadBattleNotesStrict reports a notes.json that exists but does not
// parse, so writers can refuse to overwrite it.
func loadBattleNotesStrict() (map[string]string, error) {
	notes := map[string]string{}
	b, err := os.ReadFile(battleNotesPath())
	if err != nil {
		return notes, nil
	}
	if err := json.Unmarshal(b, &notes); err != nil {
		return map[string]string{}, err
	}
	return notes, nil
}

// writeBattleNotes replaces notes.json atomically (temp, fsync, rename).
func writeBattleNotes(notes map[string]string) error {
	b, err := json.MarshalIndent(notes, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(battleNotesPath()), "notes.json.*.tmp")
	if err != nil {
		return err
	}
	_, err = f.Write(b)
	if serr := f.Sync(); err == nil {
		err = serr
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err == nil {
		err = os.Rename(f.Name(), battleNotesPath())
	}
	if err != nil {
		_ = os.Remove(f.Name())
	}
	return err
}

func saveBattleNote(file, note string) error {
	battleNotesMu.Lock()
	defer battleNotesMu.Unlock()
	notes, err := loadBattleNotesStrict()
	if err != nil {
		return fmt.Errorf("notes.json is unreadable, not overwriting: %w", err)
	}
	if note == "" {
		delete(notes, file)
	} else {
		notes[file] = note
	}
	return writeBattleNotes(notes)
}

// httpHandlerBattleNote saves (or clears, with an empty note) one record's
// note. Body: {"note":"..."}.
func httpHandlerBattleNote(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := r.URL.Query().Get("file")
	var body struct {
		Note string `json:"note"`
	}
	if b, err := io.ReadAll(io.LimitReader(r.Body, 64*1024)); err != nil || json.Unmarshal(b, &body) != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	// Validate and save under one lock so a concurrent compress cannot
	// rename the record in between and strand the note on the old name.
	recordFileMu.Lock()
	defer recordFileMu.Unlock()
	_, resolved, ok := resolveBattleFile(name)
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err := saveBattleNote(resolved, body.Note); err != nil {
		http.Error(w, "save failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// moveBattleNote re-keys a note when its record is renamed (gzip). An error
// means the note could not be moved, so callers keep the plain file.
func moveBattleNote(from, to string) error {
	battleNotesMu.Lock()
	defer battleNotesMu.Unlock()
	notes, err := loadBattleNotesStrict()
	if err != nil {
		logger.Println("notes.json is unreadable, note not moved:", err)
		return err
	}
	note, ok := notes[from]
	if !ok {
		return nil
	}
	delete(notes, from)
	notes[to] = note
	if err := writeBattleNotes(notes); err != nil {
		logger.Println("moving note failed:", err)
		return err
	}
	return nil
}

package main

import (
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
	notes := map[string]string{}
	b, err := os.ReadFile(battleNotesPath())
	if err == nil {
		_ = json.Unmarshal(b, &notes)
	}
	return notes
}

func saveBattleNote(file, note string) error {
	battleNotesMu.Lock()
	defer battleNotesMu.Unlock()
	notes := loadBattleNotesLocked()
	if note == "" {
		delete(notes, file)
	} else {
		notes[file] = note
	}
	b, err := json.MarshalIndent(notes, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(battleNotesPath(), b, 0o644)
}

// httpHandlerBattleNote saves (or clears, with an empty note) one record's
// note. Body: {"note":"..."}.
func httpHandlerBattleNote(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := r.URL.Query().Get("file")
	if _, ok := validBattleFile(name); !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	var body struct {
		Note string `json:"note"`
	}
	if b, err := io.ReadAll(io.LimitReader(r.Body, 64*1024)); err != nil || json.Unmarshal(b, &body) != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}
	if err := saveBattleNote(name, body.Note); err != nil {
		http.Error(w, "save failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

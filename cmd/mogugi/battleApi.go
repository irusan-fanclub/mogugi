package main

import (
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
)

// validBattleFile accepts only a bare .ndjson filename that exists inside
// the dungeon-log dir — the index is the only intended source of names, and
// this keeps traversal (or absolute paths) out.
func validBattleFile(name string) (string, bool) {
	if name == "" || name != filepath.Base(name) || filepath.Ext(name) != ".ndjson" {
		return "", false
	}
	p := filepath.Join(dungeonLogDirPath, name)
	if info, err := os.Stat(p); err != nil || info.IsDir() {
		return "", false
	}
	return p, true
}

// httpHandlerBattleContent streams one recorded run for the in-app loader.
func httpHandlerBattleContent(w http.ResponseWriter, r *http.Request) {
	p, ok := validBattleFile(r.URL.Query().Get("file"))
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	http.ServeFile(w, r, p)
}

// revealFile opens Explorer with the file selected; a variable so tests can
// stub the launch.
var revealFile = func(path string) error {
	return exec.Command("explorer", "/select,", path).Start()
}

// httpHandlerBattleReveal opens the file's location in Explorer.
func httpHandlerBattleReveal(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	p, ok := validBattleFile(r.URL.Query().Get("file"))
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err := revealFile(p); err != nil {
		http.Error(w, "reveal failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// recycleFile sends the file to the Windows recycle bin; a variable so
// tests can stub the shell call.
var recycleFile = func(path string) error {
	script := `Add-Type -AssemblyName Microsoft.VisualBasic; ` +
		`[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile('` + path + `','OnlyErrorDialogs','SendToRecycleBin')`
	return exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script).Run()
}

// httpHandlerBattleDelete moves one record to the recycle bin and drops its
// note. The currently-recording file is protected by validBattleFile only
// insofar as the UI never lists it with a summary; deleting it mid-run is
// additionally refused here.
func httpHandlerBattleDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	name := r.URL.Query().Get("file")
	p, ok := validBattleFile(name)
	if !ok || name == getOpenDungeonFile() {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err := recycleFile(p); err != nil {
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}
	_ = saveBattleNote(name, "")
	w.WriteHeader(http.StatusNoContent)
}

package app

import (
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
)

// validBattleFile accepts only a bare .ndjson / .ndjson.gz filename that exists inside
// the dungeon-log dir — the index is the only intended source of names, and
// this keeps traversal (or absolute paths) out.
func validBattleFile(name string) (string, bool) {
	if name == "" || name != filepath.Base(name) || !isBattleFileName(name) {
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
	p, _, ok := resolveBattleFile(r.URL.Query().Get("file"))
	if !ok {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	w.Header().Set("Content-Type", "application/x-ndjson")
	if !isGzBattleFile(p) {
		http.ServeFile(w, r, p)
		return
	}
	rc, err := openBattleFile(p)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	defer rc.Close()
	// No Content-Length: the decompressed size is unknown up front.
	ew := &errTrackWriter{w: w}
	if _, err := io.Copy(ew, rc); err != nil && !ew.failed {
		// Corrupt gzip mid-stream: abort so the client sees a failed
		// response instead of a silently truncated record.
		panic(http.ErrAbortHandler)
	}
}

// errTrackWriter remembers whether a failure came from the client side.
type errTrackWriter struct {
	w      io.Writer
	failed bool
}

func (e *errTrackWriter) Write(p []byte) (int, error) {
	n, err := e.w.Write(p)
	if err != nil {
		e.failed = true
	}
	return n, err
}

// battleTwinName returns the other storage form of a record name.
func battleTwinName(name string) string {
	if isGzBattleFile(name) {
		return name[:len(name)-3]
	}
	return name + ".gz"
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
	p, _, ok := resolveBattleFile(r.URL.Query().Get("file"))
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
	return recycleCommand(path).Run()
}

// Pass the path as data so quotes and PowerShell expressions stay literal.
func recycleCommand(path string) *exec.Cmd {
	const script = "$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName Microsoft.VisualBasic; " +
		"[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($env:MOGUGI_RECYCLE_PATH,'OnlyErrorDialogs','SendToRecycleBin')"
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.Env = append(os.Environ(), "MOGUGI_RECYCLE_PATH="+path)
	return cmd
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
	// Held across the recycles so a compress cannot recreate the record
	// or rename it under us.
	recordFileMu.Lock()
	defer recordFileMu.Unlock()
	p, name, ok := resolveBattleFile(name)
	if !ok || name == getOpenDungeonFile() {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	if err := recycleFile(p); err != nil {
		http.Error(w, "delete failed", http.StatusInternalServerError)
		return
	}
	// A compress in flight (or a failed cleanup) may leave the other form.
	twin := battleTwinName(name)
	if tp, tok := validBattleFile(twin); tok {
		if err := recycleFile(tp); err != nil {
			http.Error(w, "delete failed", http.StatusInternalServerError)
			return
		}
	}
	_ = saveBattleNote(name, "")
	_ = saveBattleNote(twin, "")
	w.WriteHeader(http.StatusNoContent)
}

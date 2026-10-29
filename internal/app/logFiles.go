package app

import (
	"archive/zip"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/util"
)

// interfaceAddrs is the local address source; a variable for tests.
var interfaceAddrs = net.InterfaceAddrs

func logsDir() string { return DataPath("logs") }

// lanURLs lists one http://<ipv4>:<port>/ per non-loopback IPv4 address.
func lanURLs(p int) []string {
	urls := []string{}
	addrs, err := interfaceAddrs()
	if err != nil {
		return urls
	}
	for _, a := range addrs {
		var ip net.IP
		switch v := a.(type) {
		case *net.IPNet:
			ip = v.IP
		case *net.IPAddr:
			ip = v.IP
		}
		if ip4 := ip.To4(); ip4 != nil && !ip4.IsLoopback() {
			urls = append(urls, fmt.Sprintf("http://%s:%d/", ip4, p))
		}
	}
	return urls
}

// logKindGlobs maps a clear kind to base-name patterns shaped like the real
// stamps (yyyymmdd_hhmmss) so a user's own files never match.
func logKindGlobs(kind string) []string {
	switch kind {
	case "log":
		return []string{"mogugi_????????_??????.log", "packet_log_????????_??????.ndjson", "debug_????????_??????*.zip"}
	case "pcap":
		return []string{"packet_capture_????????_??????*.pcapng"}
	}
	return nil
}

// kindFiles lists regular files in logs/ whose base name matches the kind.
// Matching is on the base name only, so brackets in the install path are safe.
func kindFiles(kind string) map[string]int64 {
	out := map[string]int64{}
	entries, err := os.ReadDir(logsDir())
	if err != nil {
		return out
	}
	for _, e := range entries {
		if !e.Type().IsRegular() {
			continue
		}
		for _, g := range logKindGlobs(kind) {
			if ok, _ := filepath.Match(g, e.Name()); !ok {
				continue
			}
			if fi, err := e.Info(); err == nil {
				out[filepath.Join(logsDir(), e.Name())] = fi.Size()
			}
			break
		}
	}
	return out
}

func sumSizes(m map[string]int64) (n int64) {
	for _, s := range m {
		n += s
	}
	return n
}

// logUsage returns the bytes held by text logs and by raw pcapng records.
func logUsage() (logBytes, pcapBytes int64) {
	return sumSizes(kindFiles("log")), sumSizes(kindFiles("pcap"))
}

// isCurrentSessionFile reports files the running process still writes.
func isCurrentSessionFile(path string) bool {
	base, pl := filepath.Base(path), packetLogPath()
	if base == fmt.Sprintf("mogugi_%s.log", util.StartStamp) {
		return true
	}
	if pl != "" && filepath.Base(pl) == base {
		return true
	}
	return strings.HasPrefix(base, "packet_capture_") && strings.Contains(base, util.StartStamp)
}

// clearLogs recycles every file of the kind except this session's. It keeps
// going past failures and returns the freed bytes and the failed base names.
func clearLogs(kind string) (int64, []string, error) {
	if logKindGlobs(kind) == nil {
		return 0, nil, fmt.Errorf("unknown kind %q", kind)
	}
	var paths []string
	sizes := kindFiles(kind)
	for p := range sizes {
		if !isCurrentSessionFile(p) {
			paths = append(paths, p)
		}
	}
	sort.Strings(paths)
	var freed int64
	failed := []string{}
	// Chunked: every chunk's paths ride in one environment variable (32K limit).
	for start := 0; start < len(paths); start += recycleChunk {
		chunk := paths[start:min(start+recycleChunk, len(paths))]
		failedIdx, err := recycleFiles(chunk)
		if err != nil {
			logger.Printf("logs: recycling %d %s files failed: %v", len(chunk), kind, err)
		}
		bad := map[int]bool{}
		for _, i := range failedIdx {
			bad[i] = true
		}
		for i, p := range chunk {
			if err != nil || bad[i] {
				failed = append(failed, filepath.Base(p))
			} else {
				freed += sizes[p]
			}
		}
	}
	return freed, failed, nil
}

// recycleChunk keeps one batch's joined paths well under the 32K env limit.
const recycleChunk = 100

func addZipFile(zw *zip.Writer, path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	w, err := zw.Create(filepath.Base(path))
	if err != nil {
		return err
	}
	_, err = io.Copy(w, f)
	return err
}

// packLogs zips the current and 3 previous text logs, the packet log and the
// config (never license material), then reveals the zip.
func packLogs() (string, error) {
	if err := os.MkdirAll(logsDir(), os.ModePerm); err != nil {
		return "", err
	}
	cur := filepath.Join(logsDir(), fmt.Sprintf("mogugi_%s.log", util.StartStamp))
	files := []string{cur}
	prev := []string{}
	for p := range kindFiles("log") {
		if ok, _ := filepath.Match("mogugi_????????_??????.log", filepath.Base(p)); ok {
			prev = append(prev, p)
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(prev)))
	for _, p := range prev {
		if p != cur && len(files) < 4 {
			files = append(files, p)
		}
	}
	if pl := packetLogPath(); pl != "" {
		files = append(files, pl)
	}
	files = append(files, appConfigPath())

	stamp := util.FileStamp(time.Now())
	var out *os.File
	var name, zipPath string
	for i := 1; ; i++ {
		name = fmt.Sprintf("debug_%s.zip", stamp)
		if i > 1 {
			name = fmt.Sprintf("debug_%s_%d.zip", stamp, i)
		}
		zipPath = filepath.Join(logsDir(), name)
		f, err := os.OpenFile(zipPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			out = f
			break
		}
		if !os.IsExist(err) {
			return "", err
		}
	}
	var err error
	zw := zip.NewWriter(out)
	for _, f := range files {
		if _, serr := os.Stat(f); serr != nil {
			continue // a missing optional file is just left out
		}
		if err = addZipFile(zw, f); err != nil {
			break
		}
	}
	if cerr := zw.Close(); err == nil {
		err = cerr
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(zipPath)
		return "", err
	}
	if err := revealFile(zipPath); err != nil {
		logger.Println("reveal debug zip failed:", err)
	}
	return name, nil
}

func requirePost(w http.ResponseWriter, r *http.Request) bool {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return false
	}
	return true
}

func launch(w http.ResponseWriter, r *http.Request, fn func(string) error, path string) {
	if !requirePost(w, r) {
		return
	}
	if err := fn(path); err != nil {
		http.Error(w, "launch failed", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func httpHandlerConfigOpen(w http.ResponseWriter, r *http.Request) {
	launch(w, r, openPath, appConfigPath())
}

func httpHandlerConfigReveal(w http.ResponseWriter, r *http.Request) {
	launch(w, r, revealFile, appConfigPath())
}

func httpHandlerLogsOpen(w http.ResponseWriter, r *http.Request) {
	_ = os.MkdirAll(logsDir(), os.ModePerm)
	launch(w, r, openPath, logsDir())
}

func httpHandlerLogsUsage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	l, p := logUsage()
	writeLicenseJSON(w, http.StatusOK, map[string]int64{"logBytes": l, "pcapBytes": p})
}

func httpHandlerLogsClear(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	kind := r.URL.Query().Get("kind")
	if logKindGlobs(kind) == nil {
		writeConfigError(w, http.StatusBadRequest, "kind 只能是 log 或 pcap")
		return
	}
	freed, failed, err := clearLogs(kind)
	if err != nil {
		writeConfigError(w, http.StatusInternalServerError, err.Error())
		return
	}
	// 207 (partial) carries the same body as 200 so the UI can list failures.
	status := http.StatusOK
	if len(failed) > 0 {
		status = http.StatusMultiStatus
	}
	writeLicenseJSON(w, status, map[string]any{"freedBytes": freed, "failed": failed})
}

func httpHandlerLogsPack(w http.ResponseWriter, r *http.Request) {
	if !requirePost(w, r) {
		return
	}
	name, err := packLogs()
	if err != nil {
		writeConfigError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeLicenseJSON(w, http.StatusOK, map[string]string{"name": name})
}

// recycleFiles sends many files to the recycle bin in one PowerShell call and
// returns the indices that failed; a variable so tests can stub it.
var recycleFiles = func(paths []string) ([]int, error) {
	if len(paths) == 0 {
		return nil, nil
	}
	out, err := recycleBatchCommand(paths).Output()
	if err != nil {
		return nil, err
	}
	var failed []int
	for _, f := range strings.Fields(string(out)) {
		if i, aerr := strconv.Atoi(f); aerr == nil && i >= 0 && i < len(paths) {
			failed = append(failed, i)
		}
	}
	return failed, nil
}

// Paths travel in an env var (newline-joined), never in the script text.
// The script prints the index of every path that failed.
func recycleBatchCommand(paths []string) *exec.Cmd {
	const script = "Add-Type -AssemblyName Microsoft.VisualBasic; $i = 0; " +
		"foreach ($p in ($env:MOGUGI_RECYCLE_PATHS -split \"`n\")) { try { " +
		"[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') " +
		"} catch { Write-Output $i }; $i++ }"
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.Env = append(os.Environ(), "MOGUGI_RECYCLE_PATHS="+strings.Join(paths, "\n"))
	return cmd
}

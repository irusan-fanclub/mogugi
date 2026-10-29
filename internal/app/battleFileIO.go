package app

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const (
	battleFileExt   = ".ndjson"
	battleFileExtGz = ".ndjson.gz"
)

// isBattleFileName reports whether name is a plain or gzipped run record.
func isBattleFileName(name string) bool {
	l := strings.ToLower(name)
	return strings.HasSuffix(l, battleFileExt) || strings.HasSuffix(l, battleFileExtGz)
}

func isGzBattleFile(name string) bool {
	return strings.HasSuffix(strings.ToLower(name), battleFileExtGz)
}

// gzBattleReader gunzips a record and reports how many compressed bytes
// were consumed, which is what replay progress is measured against.
type gzBattleReader struct {
	zr *gzip.Reader
	cr *countingReader
	f  *os.File
}

type countingReader struct {
	r io.Reader
	n int64
}

func (c *countingReader) Read(p []byte) (int, error) {
	n, err := c.r.Read(p)
	c.n += int64(n)
	return n, err
}

func (g *gzBattleReader) Read(p []byte) (int, error) { return g.zr.Read(p) }

// Pos is the number of compressed bytes read so far.
func (g *gzBattleReader) Pos() int64 { return g.cr.n }

// Extra is the gzip header's extra field (meta + summary of the record).
func (g *gzBattleReader) Extra() []byte { return g.zr.Header.Extra }

func (g *gzBattleReader) Close() error {
	_ = g.zr.Close()
	return g.f.Close()
}

func openGzBattleReader(path string) (*gzBattleReader, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	cr := &countingReader{r: f}
	zr, err := gzip.NewReader(cr)
	if err != nil {
		f.Close()
		return nil, err
	}
	return &gzBattleReader{zr: zr, cr: cr, f: f}, nil
}

// openBattleFile opens a record for reading, gunzipping .ndjson.gz
// transparently.
func openBattleFile(path string) (io.ReadCloser, error) {
	if !isGzBattleFile(path) {
		return os.Open(path)
	}
	return openGzBattleReader(path)
}

// resolveBattleFile finds a record by name, falling back to the gzip twin
// when a plain name went stale because the record was compressed since the
// client listed it. The returned name is the one that exists.
func resolveBattleFile(name string) (path, resolved string, ok bool) {
	if p, ok := validBattleFile(name); ok {
		return p, name, true
	}
	if name != "" && !isGzBattleFile(name) {
		if p, ok := validBattleFile(name + ".gz"); ok {
			return p, name + ".gz", true
		}
	}
	return "", "", false
}

// removeBattleFile is a variable so tests can fail the removal.
var removeBattleFile = os.Remove

// removeRetryDelay is the base backoff between removal attempts (a replay or
// download may briefly hold the file open on Windows).
var removeRetryDelay = 100 * time.Millisecond

func removeWithRetry(path string) error {
	var err error
	for i := 0; i < 4; i++ {
		if err = removeBattleFile(path); err == nil || os.IsNotExist(err) {
			return nil
		}
		time.Sleep(removeRetryDelay * time.Duration(i+1))
	}
	return err
}

// compressTestHook runs after the temp copy is written; tests use it to
// interleave a delete.
var compressTestHook func()

// compressPreVerifyHook runs on the temp file just before it is verified.
var compressPreVerifyHook func(tmp string)

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}

// gzExtra is the JSON stored in a record's gzip header so the index can list
// it without gunzipping the whole file.
type gzExtra struct {
	Meta    json.RawMessage `json:"meta"`
	Summary json.RawMessage `json:"summary"`
}

// buildGzExtra returns nil when the pair does not fit the 64 KiB field.
func buildGzExtra(meta, sum []byte) []byte {
	b, err := json.Marshal(gzExtra{Meta: meta, Summary: sum})
	if err != nil || len(b) > 0xffff {
		return nil
	}
	return b
}

func parseGzExtra(extra []byte) (meta dungeonLogMeta, sum dungeonLogSummary, ok bool) {
	var x gzExtra
	if len(extra) == 0 || json.Unmarshal(extra, &x) != nil {
		return
	}
	if json.Unmarshal(x.Meta, &meta) != nil || meta.Kind != "meta" ||
		json.Unmarshal(x.Summary, &sum) != nil || sum.Kind != "summary" {
		return meta, sum, false
	}
	return meta, sum, true
}

// plainHeaderExtra builds the header extra from a plain record's first line
// and summary tail; nil when it has no summary.
func plainHeaderExtra(path string) []byte {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil
	}
	sum, _, ok := readSummaryTail(f, info.Size())
	if !ok {
		return nil
	}
	first, err := bufio.NewReaderSize(f, 1<<16).ReadBytes('\n')
	if err != nil && len(first) == 0 {
		return nil
	}
	sb, err := json.Marshal(sum)
	if err != nil {
		return nil
	}
	return buildGzExtra(bytes.TrimSpace(first), sb)
}

// compressBattleFile gzips path to <path>.gz with the default level.
func compressBattleFile(path string) (string, error) {
	return compressBattleFileLevel(path, gzip.DefaultCompression)
}

// compressBattleFileLevel gzips path to <path>.gz and removes the original.
// The copy goes to a unique temp file that is fsynced and verified (length
// and gunzip) before the rename, and the original is deleted last, so a
// crash never leaves neither copy. An existing .gz is never overwritten and a
// source deleted meanwhile is not resurrected. If the original cannot be
// removed both files stay and the startup sweep resolves the twin.
func compressBattleFileLevel(path string, level int) (string, error) {
	if !strings.HasSuffix(strings.ToLower(path), battleFileExt) {
		return "", fmt.Errorf("not a plain record: %s", path)
	}
	recordFileMu.Lock()
	defer recordFileMu.Unlock()
	gzPath := path + ".gz"
	if fileExists(gzPath) {
		logger.Printf("dungeon-log: %s already exists, keeping the plain file", filepath.Base(gzPath))
		return "", fmt.Errorf("gz target exists: %s", gzPath)
	}
	info, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	tmpf, err := os.CreateTemp(filepath.Dir(path), filepath.Base(gzPath)+".*.tmp")
	if err != nil {
		return "", err
	}
	tmp := tmpf.Name()
	extra := plainHeaderExtra(path)
	n, err := gzipTo(path, tmpf, level, extra)
	if err == nil && n != info.Size() {
		err = fmt.Errorf("source changed while compressing: read %d of %d bytes", n, info.Size())
	}
	if compressPreVerifyHook != nil {
		compressPreVerifyHook(tmp)
	}
	if err == nil {
		if gn, ok := gzUncompressedSize(tmp); !ok || gn != info.Size() {
			err = fmt.Errorf("verification of %s failed", filepath.Base(tmp))
		}
	}
	if err == nil {
		err = os.Chtimes(tmp, info.ModTime(), info.ModTime())
	}
	if err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	if compressTestHook != nil {
		compressTestHook()
	}
	if !fileExists(path) || fileExists(gzPath) {
		_ = os.Remove(tmp)
		return "", fmt.Errorf("record gone or twin appeared: %s", path)
	}
	if err := os.Rename(tmp, gzPath); err != nil {
		_ = os.Remove(tmp)
		return "", err
	}
	if extra == nil {
		markHeaderless(gzPath)
	}
	// Deleted between the check and the rename: drop the copy again.
	if !fileExists(path) {
		_ = os.Remove(gzPath)
		return "", fmt.Errorf("record deleted during compress: %s", path)
	}
	if err := moveBattleNote(filepath.Base(path), filepath.Base(gzPath)); err != nil {
		return gzPath, err // keep the plain file so its note stays reachable
	}
	if err := removeWithRetry(path); err != nil {
		logger.Printf("dungeon-log: keeping %s next to its gz: %v", filepath.Base(path), err)
		return gzPath, err
	}
	return gzPath, nil
}

// gzUncompressedSize gunzips path to the end and returns the byte count;
// ok is false when the stream is not a clean gzip.
func gzUncompressedSize(path string) (int64, bool) {
	rc, err := openGzBattleReader(path)
	if err != nil {
		return 0, false
	}
	defer rc.Close()
	n, err := io.Copy(io.Discard, rc)
	return n, err == nil
}

// gzHeaderOK is a cheap check that path starts like a gzip stream.
func gzHeaderOK(path string) bool {
	rc, err := openGzBattleReader(path)
	if err != nil {
		return false
	}
	rc.Close()
	return true
}

// sweepDelay is how long after startup the sweep begins; sweepPoll is how
// often it re-checks for a running dungeon record. Variables for tests.
var (
	sweepDelay = 30 * time.Second
	sweepPoll  = 5 * time.Second
)

// startBattleSweep runs the sweep once, in the background, after a delay so
// it never competes with the app's startup work.
func startBattleSweep(ctx context.Context, dir string) {
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(sweepDelay):
		}
		sweepBattleFiles(ctx, dir, getOpenDungeonFile)
	}()
}

// waitNoOpenRecord blocks while a dungeon record is being written, so bulk
// compression never competes with a run; false when ctx ended.
func waitNoOpenRecord(ctx context.Context, open func() string) bool {
	for open() != "" {
		select {
		case <-ctx.Done():
			return false
		case <-time.After(sweepPoll):
		}
	}
	return ctx.Err() == nil
}

// sweepBattleFiles drops stale gzip temp files, resolves plain+gz twins,
// upgrades old summaries, then compresses closed plain records (one at a
// time, fastest level) that carry a summary. open names the file being
// recorded now; the sweep pauses while it is non-empty.
func sweepBattleFiles(ctx context.Context, dir string, open func() string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		lower := strings.ToLower(name)
		if e.IsDir() {
			continue
		}
		if strings.HasSuffix(lower, ".tmp") && strings.Contains(lower, battleFileExtGz) {
			recordFileMu.Lock()
			_ = os.Remove(filepath.Join(dir, name))
			recordFileMu.Unlock()
			continue
		}
		if strings.HasSuffix(lower, battleFileExt) && name != open() {
			resolveTwin(dir, name)
		}
	}
	backfillSummaries(dir)
	entries, err = os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		if ctx.Err() != nil {
			return
		}
		if e.IsDir() || !strings.HasSuffix(strings.ToLower(name), battleFileExt) {
			continue
		}
		if !waitNoOpenRecord(ctx, open) {
			return
		}
		if !hasSummaryLine(filepath.Join(dir, name)) {
			continue
		}
		if _, err := compressBattleFileLevel(filepath.Join(dir, name), gzip.BestSpeed); err != nil {
			logger.Println("sweep: gzip failed:", name, err)
		}
	}
}

// resolveTwin settles a plain record that has a .gz twin. The plain file is
// deleted only when the gz gunzips cleanly to exactly its size; a broken gz
// is set aside as .corrupt; any other mismatch keeps both.
func resolveTwin(dir, name string) {
	recordFileMu.Lock()
	defer recordFileMu.Unlock()
	plain, gz := filepath.Join(dir, name), filepath.Join(dir, name+".gz")
	if !fileExists(gz) {
		return
	}
	info, err := os.Stat(plain)
	if err != nil {
		return
	}
	n, ok := gzUncompressedSize(gz)
	switch {
	case !ok:
		logger.Printf("sweep: %s.gz is corrupt, setting it aside and keeping the plain file", name)
		_ = os.Rename(gz, gz+".corrupt")
	case n != info.Size():
		logger.Printf("sweep: %s and its gz differ in size, keeping both", name)
	default:
		if moveBattleNote(name, name+".gz") == nil {
			_ = removeWithRetry(plain)
		}
	}
}

func hasSummaryLine(path string) bool {
	f, err := os.Open(path)
	if err != nil {
		return false
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return false
	}
	_, _, ok := readSummaryTail(f, info.Size())
	return ok
}

// gzipTo compresses src into out (and closes it), fsyncing before the
// close, and returns the uncompressed byte count.
func gzipTo(src string, out *os.File, level int, extra []byte) (int64, error) {
	in, err := os.Open(src)
	if err != nil {
		out.Close()
		return 0, err
	}
	defer in.Close()
	zw, err := gzip.NewWriterLevel(out, level)
	if err != nil {
		out.Close()
		return 0, err
	}
	zw.Extra = extra
	n, err := io.Copy(zw, in)
	if cerr := zw.Close(); err == nil {
		err = cerr
	}
	if serr := out.Sync(); err == nil {
		err = serr
	}
	if cerr := out.Close(); err == nil {
		err = cerr
	}
	return n, err
}

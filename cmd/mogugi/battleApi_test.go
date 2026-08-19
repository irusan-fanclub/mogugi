package main

import (
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestBattleContentServesWholeFile(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir
	writeFile(t, dir, "run.ndjson", "{\"Kind\":\"meta\"}\n{\"EventId\":1}\n")

	rr := httptest.NewRecorder()
	httpHandlerBattleContent(rr, httptest.NewRequest("GET", "/api/battles/content?file=run.ndjson", nil))
	if rr.Code != 200 || rr.Body.String() != "{\"Kind\":\"meta\"}\n{\"EventId\":1}\n" {
		t.Fatalf("code=%d body=%q", rr.Code, rr.Body.String())
	}
}

// Path traversal and absolute paths must 404, never read outside the dir.
func TestBattleContentRejectsTraversal(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir
	outside := filepath.Join(dir, "..", "secret.ndjson")
	if err := os.WriteFile(outside, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"../secret.ndjson", `..\secret.ndjson`, outside, "run.txt", ""} {
		rr := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/api/battles/content", nil)
		q := req.URL.Query()
		q.Set("file", name)
		req.URL.RawQuery = q.Encode()
		httpHandlerBattleContent(rr, req)
		if rr.Code != 404 {
			t.Fatalf("file=%q code=%d, want 404", name, rr.Code)
		}
	}
}

func TestBattleRevealValidatesAndLaunches(t *testing.T) {
	dir := t.TempDir()
	dungeonLogDirPath = dir
	writeFile(t, dir, "run.ndjson", "{}\n")

	orig := revealFile
	defer func() { revealFile = orig }()
	got := ""
	revealFile = func(path string) error { got = path; return nil }

	rr := httptest.NewRecorder()
	httpHandlerBattleReveal(rr, httptest.NewRequest("POST", "/api/battles/reveal?file=run.ndjson", nil))
	if rr.Code != 204 || got != filepath.Join(dir, "run.ndjson") {
		t.Fatalf("code=%d got=%q", rr.Code, got)
	}

	rr = httptest.NewRecorder()
	httpHandlerBattleReveal(rr, httptest.NewRequest("GET", "/api/battles/reveal?file=run.ndjson", nil))
	if rr.Code != 405 {
		t.Fatalf("GET must 405, got %d", rr.Code)
	}

	rr = httptest.NewRecorder()
	httpHandlerBattleReveal(rr, httptest.NewRequest("POST", "/api/battles/reveal?file=nope.ndjson", nil))
	if rr.Code != 404 {
		t.Fatalf("missing file must 404, got %d", rr.Code)
	}
}

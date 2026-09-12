package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseAppConfig_RoundTrip(t *testing.T) {
	want := appConfig{SavePcapng: false, AutoOpenBrowser: true, AutoPort: false, Port: 8035}
	got, msg := parseAppConfig(renderAppConfig(want))
	if msg != "" || got != want {
		t.Fatalf("got %+v msg=%q want %+v", got, msg, want)
	}
}

func TestParseAppConfig_DefaultsAndUnknownKeys(t *testing.T) {
	got, msg := parseAppConfig("\ufeff# only a comment\nsomethingElse = 1\nport = 8031\n")
	if msg != "" {
		t.Fatalf("msg=%q want empty", msg)
	}
	if got.SavePcapng || !got.AutoOpenBrowser || !got.AutoPort || got.Port != 8031 {
		t.Fatalf("got %+v", got)
	}
}

func TestParseAppConfig_AutoPortKey(t *testing.T) {
	got, msg := parseAppConfig("autoPort = false\n")
	if msg != "" || got.AutoPort || !got.AutoOpenBrowser || got.Port != 8030 {
		t.Fatalf("got %+v msg=%q", got, msg)
	}
}

func TestParseAppConfig_TypeAndSyntaxErrors(t *testing.T) {
	for _, text := range []string{`port = "8030"`, "savePcapng = maybe\n", "port = 8030\nport = 8031\n"} {
		got, msg := parseAppConfig(text)
		if !strings.HasPrefix(msg, "設定檔格式錯誤:") || got != defaultAppConfig() {
			t.Fatalf("%q -> %+v msg=%q", text, got, msg)
		}
	}
}

func TestParseAppConfig_PortOutOfRange(t *testing.T) {
	got, msg := parseAppConfig("savePcapng = false\nport = 80\n")
	if got.SavePcapng || got.Port != 8030 || !strings.Contains(msg, "port 必須在 1024 到 65535 之間") {
		t.Fatalf("got %+v msg=%q", got, msg)
	}
}

func TestRenderAppConfig_HasCommentsAndCRLF(t *testing.T) {
	s := renderAppConfig(defaultAppConfig())
	for _, want := range []string{"# mogugi 設定檔", "savePcapng = false\r\n", "autoOpenBrowser = true\r\n", "autoPort = true\r\n", "port = 8030\r\n"} {
		if !strings.Contains(s, want) {
			t.Fatalf("missing %q in %q", want, s)
		}
	}
	if strings.Contains(strings.ReplaceAll(s, "\r\n", ""), "\n") || strings.HasPrefix(s, "\ufeff") {
		t.Fatal("expected CRLF only, no BOM")
	}
	if strings.Contains(s, "%!") {
		t.Fatal("template has a stray % verb")
	}
	if strings.Index(s, "autoPort = ") > strings.Index(s, "port = 8030") {
		t.Fatal("autoPort block must precede port")
	}
}

func TestValidateAppConfig_Port(t *testing.T) {
	if err := validateAppConfig(appConfig{Port: 1023}); err == nil || err.Error() != "port 必須在 1024 到 65535 之間" {
		t.Fatalf("err=%v", err)
	}
	if err := validateAppConfig(appConfig{Port: 65535}); err != nil {
		t.Fatal(err)
	}
}

func TestLoadAppConfig_MissingFileWritesDefaults(t *testing.T) {
	path := filepath.Join(t.TempDir(), appConfigFileName)
	cfg, msg, created := loadAppConfig(path)
	if !created || msg != "" || cfg != defaultAppConfig() {
		t.Fatalf("cfg=%+v msg=%q created=%v", cfg, msg, created)
	}
	b, err := os.ReadFile(path)
	if err != nil || string(b) != renderAppConfig(defaultAppConfig()) {
		t.Fatalf("file=%q err=%v", b, err)
	}
}

func TestLoadAppConfig_BadFileKeptIntact(t *testing.T) {
	path := filepath.Join(t.TempDir(), appConfigFileName)
	bad := "port = \"oops\"\n"
	if err := os.WriteFile(path, []byte(bad), 0o644); err != nil {
		t.Fatal(err)
	}
	cfg, msg, created := loadAppConfig(path)
	if created || msg == "" || cfg != defaultAppConfig() {
		t.Fatalf("cfg=%+v msg=%q created=%v", cfg, msg, created)
	}
	if b, _ := os.ReadFile(path); string(b) != bad {
		t.Fatalf("bad file was overwritten: %q", b)
	}
}

func TestSaveAppConfig_AtomicAndValidated(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, appConfigFileName)
	c := appConfig{SavePcapng: false, AutoOpenBrowser: false, AutoPort: true, Port: 8040}
	if err := saveAppConfig(path, c); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(path); string(b) != renderAppConfig(c) {
		t.Fatalf("file=%q", b)
	}
	if matches, err := filepath.Glob(filepath.Join(dir, appConfigFileName+"*.tmp")); err != nil || len(matches) != 0 {
		t.Fatalf("temp file left behind: %v err=%v", matches, err)
	}
	// Overwrite an existing file (Windows rename must replace).
	c.Port = 8041
	if err := saveAppConfig(path, c); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(path); !strings.Contains(string(b), "port = 8041") {
		t.Fatalf("file=%q", b)
	}
	if err := saveAppConfig(path, appConfig{Port: 10}); err == nil {
		t.Fatal("invalid port must not be written")
	}
	if err := saveAppConfig(filepath.Join(dir, "missing", appConfigFileName), c); err == nil {
		t.Fatal("missing directory must fail")
	}
}

func TestAppDir_OverrideAndEnv(t *testing.T) {
	old := appDirOverride
	appDirOverride = `C:\x`
	t.Cleanup(func() { appDirOverride = old })
	if got := appConfigPath(); got != filepath.Join(`C:\x`, appConfigFileName) {
		t.Fatalf("path=%q", got)
	}
	appDirOverride = ""
	t.Setenv("MOGUGI_LICENSE_DIR", `D:\y`)
	if got := appDir(); got != `D:\y` {
		t.Fatalf("dir=%q", got)
	}
}

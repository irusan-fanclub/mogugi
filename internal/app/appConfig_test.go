package app

import (
	"reflect"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestParseAppConfig_RoundTrip(t *testing.T) {
	want := appConfig{SavePcapng: false, AutoOpenBrowser: true, AutoPort: false, Port: 8035, DpsDisplay: "web", MemoryLimitMB: 150}
	got, msg := parseAppConfig(renderAppConfig(want))
	if msg != "" || !reflect.DeepEqual(got, want) {
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
		if !strings.HasPrefix(msg, "設定檔格式錯誤:") || !reflect.DeepEqual(got, defaultAppConfig()) {
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
	if !created || msg != "" || !reflect.DeepEqual(cfg, defaultAppConfig()) {
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
	if created || msg == "" || !reflect.DeepEqual(cfg, defaultAppConfig()) {
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
	old := dataDirOverride
	dataDirOverride = `C:\x`
	t.Cleanup(func() { dataDirOverride = old })
	if got := appConfigPath(); got != filepath.Join(`C:\x`, appConfigFileName) {
		t.Fatalf("path=%q", got)
	}
	dataDirOverride = ""
	t.Setenv("MOGUGI_DATA_DIR", `D:\y`)
	if got := DataDir(); got != `D:\y` {
		t.Fatalf("dir=%q", got)
	}
}

func TestAllowLanDefaultFalse(t *testing.T) {
	if defaultAppConfig().AllowLan {
		t.Fatal("default must be false")
	}
	got, msg := parseAppConfig("allowLan = true\n")
	if msg != "" || !got.AllowLan {
		t.Fatalf("got %+v msg=%q", got, msg)
	}
}

func TestAppConfig_DesktopStateRoundTrip(t *testing.T) {
	want := defaultAppConfig()
	want.TrayHintShown = true
	want.Window = WindowState{X: -10, Y: 20, Width: 1000, Height: 700, Maximized: true}
	got, msg := parseAppConfig(renderAppConfig(want))
	if msg != "" || !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v msg=%q want %+v", got, msg, want)
	}
}

func TestDesktopState_SaveKeepsUserConfigAndViceVersa(t *testing.T) {
	t.Setenv("MOGUGI_DATA_DIR", t.TempDir())
	appCfgMu.Lock()
	appCfg, appCfgLoadError = defaultAppConfig(), ""
	appCfgMu.Unlock()
	appCfg.Port = 8035
	if err := SaveWindowState(WindowState{Width: 900, Height: 600}); err != nil {
		t.Fatal(err)
	}
	if err := MarkTrayHintShown(); err != nil {
		t.Fatal(err)
	}
	got, loadErr, _ := loadAppConfig(appConfigPath())
	if loadErr != "" || got.Port != 8035 || got.Window.Width != 900 || !got.TrayHintShown {
		t.Fatalf("got %+v err=%q", got, loadErr)
	}
	appCfgLoadError = "broken"
	if SaveWindowState(WindowState{Width: 1}) == nil {
		t.Fatal("expected refusal while config file is broken")
	}
	appCfgLoadError = ""
}

func TestChartWindowsConfigRoundTrip(t *testing.T) {
	want := defaultAppConfig()
	want.ChartWindows = map[string]WindowState{
		"dps":    {X: 10, Y: 20, Width: 500, Height: 300},
		"hitlog": {X: -5, Y: 6, Width: 700, Height: 400, Maximized: true},
		"count":  {X: 1, Y: 2}, // Width==0: not written
	}
	text := renderAppConfig(want)
	if strings.Contains(text, "chartWindows.count") {
		t.Fatalf("unset entry was rendered:\n%s", text)
	}
	if strings.Index(text, "[chartWindows.dps]") > strings.Index(text, "[chartWindows.hitlog]") {
		t.Fatal("tables must be sorted by key")
	}
	got, msg := parseAppConfig(text)
	if msg != "" {
		t.Fatal(msg)
	}
	delete(want.ChartWindows, "count")
	if !reflect.DeepEqual(got.ChartWindows, want.ChartWindows) {
		t.Fatalf("got %+v want %+v", got.ChartWindows, want.ChartWindows)
	}
}

func TestOldConfigWithoutChartWindows(t *testing.T) {
	got, msg := parseAppConfig("port = 8035\ntrayHintShown = true\n[window]\nwidth = 900\nheight = 600\n")
	if msg != "" || got.Port != 8035 || !got.TrayHintShown || got.Window.Width != 900 {
		t.Fatalf("got %+v msg=%q", got, msg)
	}
	if len(got.ChartWindows) != 0 {
		t.Fatalf("want empty, got %+v", got.ChartWindows)
	}
}

func TestChartWindowStateSaveLoad(t *testing.T) {
	t.Setenv("MOGUGI_DATA_DIR", t.TempDir())
	appCfgMu.Lock()
	appCfg, appCfgLoadError = defaultAppConfig(), ""
	appCfgMu.Unlock()
	if err := SaveChartWindowState("dps", WindowState{Width: 500, Height: 300}); err != nil {
		t.Fatal(err)
	}
	m := LoadChartWindowStates()
	if m["dps"].Width != 500 {
		t.Fatalf("got %+v", m)
	}
	m["dps"] = WindowState{} // returned map must be a copy
	if LoadChartWindowStates()["dps"].Width != 500 {
		t.Fatal("LoadChartWindowStates leaked internal map")
	}
}

func TestOverlayConfigRoundTrip(t *testing.T) {
	want := defaultAppConfig()
	want.OverlayHotkey = "Ctrl+Shift+F9"
	want.OverlayVisibleHotkey = "Alt+F2"
	want.Overlays = map[string]OverlayLayout{
		"dps":     {true, "tr", -24, 24, 260, 8, "", nil},
		"alerts":  {false, "center", 0, -170, 320, 4, "", nil},
		"ccParty": {true, "tl", 0, 0, 300, 8, "ccSelf", nil},
	}
	text := renderAppConfig(want)
	if !strings.Contains(text, "[overlay]") || !strings.Contains(text, "[overlays.dps]") {
		t.Fatalf("missing sections:\n%s", text)
	}
	got, msg := parseAppConfig(text)
	if msg != "" {
		t.Fatal(msg)
	}
	if got.OverlayHotkey != want.OverlayHotkey || got.OverlayVisibleHotkey != want.OverlayVisibleHotkey {
		t.Fatalf("hotkeys %q %q", got.OverlayHotkey, got.OverlayVisibleHotkey)
	}
	if !reflect.DeepEqual(got.Overlays, want.Overlays) {
		t.Fatalf("got %+v", got.Overlays)
	}
}

func TestValidOverlayLayoutOrder(t *testing.T) {
	base := OverlayLayout{Enabled: true, Anchor: "tl", Width: 260, MaxRows: 8}
	with := func(o []string) OverlayLayout { l := base; l.Order = o; return l }
	if !ValidOverlayLayout(with([]string{"1164", "cd-59005"})) {
		t.Fatal("valid order rejected")
	}
	if ValidOverlayLayout(with([]string{"a.b"})) || ValidOverlayLayout(with([]string{""})) {
		t.Fatal("bad order entry accepted")
	}
	if !ValidOverlayLayout(with(make64("x", 64))) || ValidOverlayLayout(with(make64("x", 65))) {
		t.Fatal("order length limit wrong")
	}
}

func make64(s string, n int) []string {
	o := make([]string, n)
	for i := range o {
		o[i] = s
	}
	return o
}

func TestOverlayOrderRoundTrip(t *testing.T) {
	c := defaultAppConfig()
	c.Overlays = map[string]OverlayLayout{
		"ccBoss": {Enabled: true, Anchor: "tl", Width: 260, MaxRows: 8, Order: []string{"1165", "1164"}},
		"dps":    {Enabled: true, Anchor: "tl", Width: 260, MaxRows: 8},
	}
	text := renderAppConfig(c)
	if strings.Count(text, "order =") != 1 {
		t.Fatalf("want exactly one order key:\n%s", text)
	}
	got, msg := parseAppConfig(text)
	if msg != "" {
		t.Fatal(msg)
	}
	if !reflect.DeepEqual(got.Overlays, c.Overlays) {
		t.Fatalf("got %+v", got.Overlays)
	}
}

func TestOverlayLayoutIgnoresOldGeometry(t *testing.T) {
	got, msg := parseAppConfig("[overlays.dps]\nenabled = true\nx = 5\ny = 6\nwidth = 260\nheight = 200\n")
	if msg != "" {
		t.Fatal(msg)
	}
	if _, ok := got.Overlays["dps"]; ok {
		t.Fatalf("old geometry kept: %+v", got.Overlays)
	}
}

func TestOverlayLayoutBadValues(t *testing.T) {
	text := "overlayLayoutVersion = 2\n[overlays.cc]\nenabled = true\nanchor = \"middle\"\nx = 0\ny = 0\nwidth = 260\nmaxRows = 8\n" +
		"[overlays.dps]\nenabled = true\nanchor = \"tl\"\nx = 0\ny = 0\nwidth = -1\nmaxRows = 8\n" +
		"[overlays.ccSelf]\nenabled = true\nanchor = \"tl\"\nx = 0\ny = 0\nwidth = 260\nmaxRows = 1\ndock = \"a b\"\n" +
		"[overlays.cooldown]\nenabled = true\nanchor = \"bl\"\nx = 3\ny = -4\nwidth = 200\nmaxRows = 5\n"
	got, msg := parseAppConfig(text)
	if msg != "" {
		t.Fatal(msg)
	}
	want := map[string]OverlayLayout{"cooldown": {true, "bl", 3, -4, 200, 5, "", nil}}
	if !reflect.DeepEqual(got.Overlays, want) {
		t.Fatalf("got %+v", got.Overlays)
	}
}

func TestOverlayLayoutOlderVersionDropped(t *testing.T) {
	lay := "[overlays.cooldown]\nenabled = true\nanchor = \"bl\"\nx = 3\ny = -4\nwidth = 200\nmaxRows = 5\n"
	if got, _ := parseAppConfig(lay); len(got.Overlays) != 0 {
		t.Fatalf("unversioned layouts kept: %+v", got.Overlays)
	}
	got, _ := parseAppConfig("overlayLayoutVersion = 2\n" + lay)
	if len(got.Overlays) != 1 {
		t.Fatalf("current layouts dropped: %+v", got.Overlays)
	}
	if !strings.Contains(renderAppConfig(got), "overlayLayoutVersion = 2") {
		t.Fatal("version not written")
	}
}

func TestOverlayConfigDefaults(t *testing.T) {
	got, msg := parseAppConfig("port = 8035\n")
	if msg != "" || got.OverlayHotkey != "" || got.OverlayVisibleHotkey != "" || len(got.Overlays) != 0 {
		t.Fatalf("got %+v msg=%q", got, msg)
	}
	if strings.Contains(renderAppConfig(got), "[overlay]") {
		t.Fatal("default hotkey must not render a section")
	}
	t.Setenv("MOGUGI_DATA_DIR", t.TempDir())
	appCfgMu.Lock()
	appCfg, appCfgLoadError = got, ""
	appCfgMu.Unlock()
	hk, vk, layouts := LoadOverlayConfig()
	if hk != "Ctrl+Alt+L" || vk != "Ctrl+Alt+O" || len(layouts) != 0 {
		t.Fatalf("hk=%q vk=%q layouts=%+v", hk, vk, layouts)
	}
}

func TestOverlayConfigRejectsBadKey(t *testing.T) {
	c := defaultAppConfig()
	c.Overlays = map[string]OverlayLayout{"bad key]": {true, "tl", 0, 0, 260, 8, "", nil}, "dps": {true, "tl", 0, 0, 260, 8, "", nil}}
	text := renderAppConfig(c)
	if strings.Contains(text, "bad key") || !strings.Contains(text, "[overlays.dps]") {
		t.Fatalf("unexpected render:\n%s", text)
	}
	if _, msg := parseAppConfig(text); msg != "" {
		t.Fatal(msg)
	}
}

func TestAppConfigMemoryLimit(t *testing.T) {
	cfg, msg := parseAppConfig("port = 8030\n")
	if cfg.MemoryLimitMB != 150 || msg != "" {
		t.Fatalf("missing key: %d %q", cfg.MemoryLimitMB, msg)
	}
	cfg, msg = parseAppConfig("memoryLimitMB = 20\n")
	if cfg.MemoryLimitMB != 150 || msg == "" {
		t.Fatalf("out of range: %d %q", cfg.MemoryLimitMB, msg)
	}
	cfg, msg = parseAppConfig("memoryLimitMB = 300\n")
	if cfg.MemoryLimitMB != 300 || msg != "" {
		t.Fatalf("valid: %d %q", cfg.MemoryLimitMB, msg)
	}
	c := defaultAppConfig()
	c.MemoryLimitMB = 300
	if !strings.Contains(renderAppConfig(c), "memoryLimitMB = 300") {
		t.Fatal("render lacks memoryLimitMB")
	}
}

func TestParseAppConfigBadMemoryKeepsOtherKeys(t *testing.T) {
	got, msg := parseAppConfig("memoryLimitMB = 20\nport = 8033\n")
	if msg == "" || got.MemoryLimitMB != DefaultMemoryLimitMB || got.Port != 8033 {
		t.Fatalf("cfg=%+v msg=%q", got, msg)
	}
}

func TestSavePacketLogRoundTrip(t *testing.T) {
	c := defaultAppConfig()
	if c.SavePacketLog {
		t.Fatal("default must be false")
	}
	c.SavePacketLog = true
	got, msg := parseAppConfig(renderAppConfig(c))
	if msg != "" || !got.SavePacketLog {
		t.Fatalf("msg=%q got=%v", msg, got.SavePacketLog)
	}
	old, _ := parseAppConfig("port = 8031\r\n")
	if old.SavePacketLog {
		t.Fatal("missing key must load false")
	}
}

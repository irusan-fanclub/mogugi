package app

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
)

// withAppConfigDir points the config file at a temp dir and resets the
// runtime config state around a test.
func withAppConfigDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	oldDir, oldCfg, oldErr, oldPort := dataDirOverride, appCfg, appCfgLoadError, port
	oldNoPcap, oldNoBrowser, oldAutoPort, oldLan := noPcapFile, noBrowser, autoPort, allowLan
	dataDirOverride = dir
	appCfg, appCfgLoadError = defaultAppConfig(), ""
	t.Cleanup(func() {
		dataDirOverride, appCfg, appCfgLoadError, port = oldDir, oldCfg, oldErr, oldPort
		noPcapFile, noBrowser, autoPort, allowLan = oldNoPcap, oldNoBrowser, oldAutoPort, oldLan
	})
	return dir
}

func getConfig(t *testing.T) appConfigView {
	t.Helper()
	rr := httptest.NewRecorder()
	httpHandlerConfig(rr, httptest.NewRequest("GET", "/api/config", nil))
	if rr.Code != 200 {
		t.Fatalf("GET code=%d body=%s", rr.Code, rr.Body.String())
	}
	var v appConfigView
	if err := json.Unmarshal(rr.Body.Bytes(), &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func putConfig(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	rr := httptest.NewRecorder()
	httpHandlerConfig(rr, httptest.NewRequest("PUT", "/api/config", strings.NewReader(body)))
	return rr
}

func TestConfigGet_ShowsFileAndEffective(t *testing.T) {
	dir := withAppConfigDir(t)
	port = 8030
	autoPort = true
	noPcapFile, noBrowser = true, false
	appCfg.SavePcapng = true
	appCfgLoadError = "設定檔格式錯誤:x"

	v := getConfig(t)
	if v.Path != filepath.Join(dir, appConfigFileName) || v.LoadError != "設定檔格式錯誤:x" {
		t.Fatalf("view=%+v", v)
	}
	if !v.File.SavePcapng || v.Effective.SavePcapng || v.Effective.Port != 8030 || !v.Effective.AutoPort {
		t.Fatalf("view=%+v", v)
	}
}

func TestConfigPut_ValidatesSavesAndFlagsRestart(t *testing.T) {
	dir := withAppConfigDir(t)
	port = 8030
	autoPort = true
	noPcapFile, noBrowser = false, false

	if rr := putConfig(t, `{"savePcapng":true,"autoOpenBrowser":true,"autoPort":true,"port":80}`); rr.Code != 400 || !strings.Contains(rr.Body.String(), "1024") {
		t.Fatalf("code=%d body=%s", rr.Code, rr.Body.String())
	}
	if rr := putConfig(t, `{"savePcapng":true,"autoOpenBrowser":true,"port":8030}`); rr.Code != 400 {
		t.Fatalf("missing autoPort must 400, got %d", rr.Code)
	}
	if rr := putConfig(t, `not json`); rr.Code != 400 {
		t.Fatalf("bad json must 400, got %d", rr.Code)
	}

	rr := putConfig(t, `{"savePcapng":false,"autoOpenBrowser":true,"autoPort":true,"port":8031}`)
	if rr.Code != 200 || strings.Contains(rr.Body.String(), `"restartRequired":true`) {
		t.Fatalf("autoPort still on: code=%d body=%s", rr.Code, rr.Body.String())
	}
	rr = putConfig(t, `{"savePcapng":false,"autoOpenBrowser":false,"autoPort":false,"port":8030}`)
	if rr.Code != 200 || !strings.Contains(rr.Body.String(), `"restartRequired":true`) {
		t.Fatalf("autoPort turned off: code=%d body=%s", rr.Code, rr.Body.String())
	}

	// Simulate a restart that picked up autoPort=false; from here only a
	// changed port (not autoPort, already matching) should flag a restart.
	autoPort = false
	rr = putConfig(t, `{"savePcapng":false,"autoOpenBrowser":false,"autoPort":false,"port":8031}`)
	if rr.Code != 200 || !strings.Contains(rr.Body.String(), `"restartRequired":true`) {
		t.Fatalf("new port: code=%d body=%s", rr.Code, rr.Body.String())
	}
	rr = putConfig(t, `{"savePcapng":false,"autoOpenBrowser":false,"autoPort":false,"port":8030}`)
	if rr.Code != 200 || strings.Contains(rr.Body.String(), `"restartRequired":true`) {
		t.Fatalf("same port: code=%d body=%s", rr.Code, rr.Body.String())
	}
	// Four sequential PUTs above all returned 200; the file must end with
	// only the last write (autoPort off, port 8030).
	b, err := os.ReadFile(filepath.Join(dir, appConfigFileName))
	if err != nil || !strings.Contains(string(b), "port = 8030") || !strings.Contains(string(b), "autoPort = false") || !strings.Contains(string(b), "savePcapng = false") {
		t.Fatalf("file=%q err=%v", b, err)
	}
	v := getConfig(t)
	if v.File.Port != 8030 || v.Effective.Port != 8030 || v.File.SavePcapng || !v.Effective.SavePcapng || v.LoadError != "" {
		t.Fatalf("view after save=%+v", v)
	}
}

func TestConfig_MethodNotAllowedAndWriteFailure(t *testing.T) {
	withAppConfigDir(t)
	rr := httptest.NewRecorder()
	httpHandlerConfig(rr, httptest.NewRequest("POST", "/api/config", nil))
	if rr.Code != 405 || !strings.Contains(rr.Body.String(), "不支援的請求方法") {
		t.Fatalf("code=%d body=%s", rr.Code, rr.Body.String())
	}
	dataDirOverride = filepath.Join(dataDirOverride, "missing")
	if rr := putConfig(t, `{"savePcapng":true,"autoOpenBrowser":true,"autoPort":true,"port":8030}`); rr.Code != 500 || !strings.Contains(rr.Body.String(), "寫入設定檔失敗") {
		t.Fatalf("code=%d body=%s", rr.Code, rr.Body.String())
	}
}

func TestConfigPut_AllowLanPersistsAndNeedsRestart(t *testing.T) {
	dir := withAppConfigDir(t)
	autoPort, allowLan = true, false
	rr := putConfig(t, `{"savePcapng":false,"autoOpenBrowser":true,"autoPort":true,"port":8030,"allowLan":true}`)
	if rr.Code != 200 || !strings.Contains(rr.Body.String(), `"restartRequired":true`) {
		t.Fatalf("code=%d body=%s", rr.Code, rr.Body.String())
	}
	b, err := os.ReadFile(filepath.Join(dir, appConfigFileName))
	if err != nil || !strings.Contains(string(b), "allowLan = true") {
		t.Fatalf("file=%q err=%v", b, err)
	}
	if v := getConfig(t); !v.File.AllowLan || v.Effective.AllowLan {
		t.Fatalf("view=%+v", v)
	}
}

func TestConfigPut_OmittedAllowLanKeepsStored(t *testing.T) {
	dir := withAppConfigDir(t)
	autoPort, allowLan = true, true
	appCfg.AllowLan = true
	rr := putConfig(t, `{"savePcapng":false,"autoOpenBrowser":true,"autoPort":true,"port":8030}`)
	if rr.Code != 200 || !strings.Contains(rr.Body.String(), `"restartRequired":false`) {
		t.Fatalf("code=%d body=%s", rr.Code, rr.Body.String())
	}
	b, _ := os.ReadFile(filepath.Join(dir, appConfigFileName))
	if !strings.Contains(string(b), "allowLan = true") || !appCfg.AllowLan {
		t.Fatalf("stored value lost: file=%q", b)
	}
}

func TestDpsDisplayValidation(t *testing.T) {
	for _, v := range []string{"desktop", "web"} {
		if err := validateAppConfig(appConfig{Port: 8030, DpsDisplay: v}); err != nil {
			t.Errorf("%q should be valid: %v", v, err)
		}
	}
	if err := validateAppConfig(appConfig{Port: 8030, DpsDisplay: "foo"}); err == nil {
		t.Error("foo should be invalid")
	}
	cfg, msg := parseAppConfig("dpsDisplay = \"foo\"\n")
	if msg == "" || cfg.DpsDisplay != "desktop" {
		t.Errorf("bad file value should fall back: cfg=%+v msg=%q", cfg, msg)
	}
	cfg, msg = parseAppConfig("dpsDisplay = \"web\"\n")
	if msg != "" || cfg.DpsDisplay != "web" {
		t.Errorf("cfg=%+v msg=%q", cfg, msg)
	}
	if rr := putConfig(t, `{"savePcapng":false,"autoOpenBrowser":true,"autoPort":true,"port":8030,"dpsDisplay":"foo"}`); rr.Code != 400 {
		t.Errorf("PUT foo code=%d", rr.Code)
	}
}

func TestConfigPutBroadcastsChange(t *testing.T) {
	withAppConfigDir(t)
	port, autoPort = 8030, true

	pub := newEventPublisherForTest(t)
	pub.ctx = context.Background()
	pub.clientMap = make(map[uint32]*eventClient)
	ch := make(chan []event.IEvent, 4)
	pub.clientMap[1] = &eventClient{ctx: context.Background(), ch: ch}
	oldPub, oldHook := currentPub, OnConfigChanged
	currentPub = pub
	hooked := make(chan ConfigSnapshot, 1)
	OnConfigChanged = func(s ConfigSnapshot) { hooked <- s }
	t.Cleanup(func() { currentPub, OnConfigChanged = oldPub, oldHook })

	rr := putConfig(t, `{"savePcapng":false,"autoOpenBrowser":true,"autoPort":true,"port":8030,"dpsDisplay":"web"}`)
	if rr.Code != 200 {
		t.Fatalf("code=%d body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		RestartRequired bool `json:"restartRequired"`
	}
	json.Unmarshal(rr.Body.Bytes(), &resp)
	if resp.RestartRequired {
		t.Error("dpsDisplay change must not require restart")
	}
	select {
	case batch := <-ch:
		if len(batch) != 1 || batch[0].GetEventId() != event.EventIdConfigChanged {
			t.Fatalf("batch=%+v", batch)
		}
		e := batch[0].(*event.EventConfigChanged)
		if !strings.Contains(string(e.Config), `"dpsDisplay":"web"`) {
			t.Errorf("config=%s", e.Config)
		}
	default:
		t.Fatal("no event broadcast")
	}
	select {
	case s := <-hooked:
		if s.DpsDisplay != "web" {
			t.Errorf("hook=%+v", s)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("hook not called")
	}
}

func TestPutConfigKeepsChartWindows(t *testing.T) {
	withAppConfigDir(t)
	appCfg.ChartWindows = map[string]WindowState{"dps": {Width: 500, Height: 300}}
	rr := putConfig(t, `{"savePcapng":false,"autoOpenBrowser":true,"autoPort":true,"port":8031}`)
	if rr.Code != 200 {
		t.Fatalf("code=%d body=%s", rr.Code, rr.Body.String())
	}
	if appCfg.ChartWindows["dps"].Width != 500 {
		t.Fatalf("in-memory lost: %+v", appCfg.ChartWindows)
	}
	b, err := os.ReadFile(filepath.Join(dataDirOverride, appConfigFileName))
	if err != nil || !strings.Contains(string(b), "[chartWindows.dps]") {
		t.Fatalf("file lost chartWindows: %v\n%s", err, b)
	}
}

func TestPutConfigPreservesOverlays(t *testing.T) {
	withAppConfigDir(t)
	if err := SaveOverlayLayout("dps", OverlayLayout{Enabled: true, Anchor: "tl", X: 1, Y: 2, Width: 260, MaxRows: 8}); err != nil {
		t.Fatal(err)
	}
	if err := SaveOverlayHotkey("Ctrl+Alt+K"); err != nil {
		t.Fatal(err)
	}
	if err := SaveOverlayVisibleHotkey("Ctrl+Alt+V"); err != nil {
		t.Fatal(err)
	}
	rr := putConfig(t, `{"savePcapng":false,"autoOpenBrowser":true,"autoPort":true,"port":8031}`)
	if rr.Code != 200 {
		t.Fatalf("code=%d body=%s", rr.Code, rr.Body.String())
	}
	hk, vk, states := LoadOverlayConfig()
	if hk != "Ctrl+Alt+K" || vk != "Ctrl+Alt+V" || states["dps"].Width != 260 {
		t.Fatalf("in-memory lost: %q %q %+v", hk, vk, states)
	}
	b, err := os.ReadFile(filepath.Join(dataDirOverride, appConfigFileName))
	if err != nil || !strings.Contains(string(b), "[overlays.dps]") || !strings.Contains(string(b), "Ctrl+Alt+K") || !strings.Contains(string(b), "Ctrl+Alt+V") {
		t.Fatalf("file lost overlays: %v\n%s", err, b)
	}
}

func TestConfigPut_MemoryLimit(t *testing.T) {
	withAppConfigDir(t)
	appCfg.MemoryLimitMB = 300
	rr := putConfig(t, `{"savePcapng":false,"autoOpenBrowser":true,"autoPort":true,"port":8030}`)
	if rr.Code != 200 || appCfg.MemoryLimitMB != 300 {
		t.Fatalf("omitted field: code=%d mb=%d", rr.Code, appCfg.MemoryLimitMB)
	}
	rr = putConfig(t, `{"savePcapng":false,"autoOpenBrowser":true,"autoPort":true,"port":8030,"memoryLimitMB":400}`)
	if rr.Code != 200 || appCfg.MemoryLimitMB != 400 {
		t.Fatalf("set: code=%d mb=%d", rr.Code, appCfg.MemoryLimitMB)
	}
	rr = putConfig(t, `{"savePcapng":false,"autoOpenBrowser":true,"autoPort":true,"port":8030,"memoryLimitMB":5}`)
	if rr.Code != 400 {
		t.Fatalf("out of range: code=%d", rr.Code)
	}
}

func TestConfigPut_SavePacketLogOptional(t *testing.T) {
	withAppConfigDir(t)
	base := `"savePcapng":false,"autoOpenBrowser":true,"autoPort":true,"port":8030`
	if rr := putConfig(t, `{`+base+`,"savePacketLog":true}`); rr.Code != 200 || !appCfg.SavePacketLog {
		t.Fatalf("code=%d stored=%v", rr.Code, appCfg.SavePacketLog)
	}
	if rr := putConfig(t, `{`+base+`}`); rr.Code != 200 || !appCfg.SavePacketLog {
		t.Fatalf("omitted must keep stored: code=%d", rr.Code)
	}
	if rr := putConfig(t, `{`+base+`,"savePacketLog":false}`); rr.Code != 200 || appCfg.SavePacketLog {
		t.Fatal("explicit false not applied")
	}
	if rr := putConfig(t, `{"savePacketLog":true}`); rr.Code != 400 {
		t.Fatalf("required fields must stay required: %d", rr.Code)
	}
}

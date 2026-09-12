package main

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// withAppConfigDir points the config file at a temp dir and resets the
// runtime config state around a test.
func withAppConfigDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	oldDir, oldCfg, oldErr, oldOv, oldPort := appDirOverride, appCfg, appCfgLoadError, appCfgOverrides, port
	oldNoPcap, oldNoBrowser, oldAutoPort := noPcapFile, noBrowser, autoPort
	appDirOverride = dir
	appCfg, appCfgLoadError, appCfgOverrides = defaultAppConfig(), "", map[string]string{}
	t.Cleanup(func() {
		appDirOverride, appCfg, appCfgLoadError, appCfgOverrides, port = oldDir, oldCfg, oldErr, oldOv, oldPort
		noPcapFile, noBrowser, autoPort = oldNoPcap, oldNoBrowser, oldAutoPort
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

func TestConfigGet_ShowsFileEffectiveAndOverrides(t *testing.T) {
	dir := withAppConfigDir(t)
	port = 8030
	autoPort = true
	noPcapFile, noBrowser = true, false
	appCfg.SavePcapng = true
	appCfgOverrides["savePcapng"] = "--no-pcap"
	appCfgLoadError = "設定檔格式錯誤:x"

	v := getConfig(t)
	if v.Path != filepath.Join(dir, appConfigFileName) || v.LoadError != "設定檔格式錯誤:x" {
		t.Fatalf("view=%+v", v)
	}
	if !v.File.SavePcapng || v.Effective.SavePcapng || v.Overrides["savePcapng"] != "--no-pcap" || v.Effective.Port != 8030 || !v.Effective.AutoPort {
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
	appDirOverride = filepath.Join(appDirOverride, "missing")
	if rr := putConfig(t, `{"savePcapng":true,"autoOpenBrowser":true,"autoPort":true,"port":8030}`); rr.Code != 500 || !strings.Contains(rr.Body.String(), "寫入設定檔失敗") {
		t.Fatalf("code=%d body=%s", rr.Code, rr.Body.String())
	}
}

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"
)

// Runtime config state. appCfg mirrors the file (what the settings tab
// edits); the effective values live in port/noPcapFile/noBrowser/autoPort
// and are derived once at start, so edits only apply on the next start.
//
// main() assigns these before the HTTP server starts, so that initial
// write needs no lock; every access after that goes through appCfgMu.
var (
	appCfg          appConfig
	appCfgLoadError string
	appCfgOverrides = map[string]string{} // json key -> CLI flag that overrode it this run
	appCfgMu        sync.Mutex
)

type appConfigView struct {
	Path      string            `json:"path"`
	File      appConfig         `json:"file"`
	Effective appConfig         `json:"effective"`
	Overrides map[string]string `json:"overrides"`
	LoadError string            `json:"loadError"`
}

// effectiveAppConfig reports the values this process is actually running with.
func effectiveAppConfig() appConfig {
	return appConfig{SavePcapng: !noPcapFile, AutoOpenBrowser: !noBrowser, AutoPort: autoPort, Port: port}
}

func currentAppConfigView() appConfigView {
	appCfgMu.Lock()
	defer appCfgMu.Unlock()
	ov := make(map[string]string, len(appCfgOverrides))
	for k, v := range appCfgOverrides {
		ov[k] = v
	}
	return appConfigView{
		Path: appConfigPath(), File: appCfg, Effective: effectiveAppConfig(),
		Overrides: ov, LoadError: appCfgLoadError,
	}
}

func writeConfigError(w http.ResponseWriter, status int, msg string) {
	writeLicenseJSON(w, status, map[string]string{"error": msg})
}

// httpHandlerConfig serves GET (current view) and PUT (validate + save).
func httpHandlerConfig(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		writeLicenseJSON(w, http.StatusOK, currentAppConfigView())
	case http.MethodPut:
		var body struct {
			SavePcapng      *bool `json:"savePcapng"`
			AutoOpenBrowser *bool `json:"autoOpenBrowser"`
			AutoPort        *bool `json:"autoPort"`
			Port            *int  `json:"port"`
		}
		b, err := io.ReadAll(io.LimitReader(r.Body, 64*1024))
		if err != nil || json.Unmarshal(b, &body) != nil || body.SavePcapng == nil || body.AutoOpenBrowser == nil || body.AutoPort == nil || body.Port == nil {
			writeConfigError(w, http.StatusBadRequest, "設定內容不完整")
			return
		}
		c := appConfig{SavePcapng: *body.SavePcapng, AutoOpenBrowser: *body.AutoOpenBrowser, AutoPort: *body.AutoPort, Port: *body.Port}

		// Held across validate -> save -> state update so two concurrent
		// PUTs never interleave their writes; GET just waits for this.
		appCfgMu.Lock()
		defer appCfgMu.Unlock()
		if err := validateAppConfig(c); err != nil {
			writeConfigError(w, http.StatusBadRequest, err.Error())
			return
		}
		path := appConfigPath()
		if err := saveAppConfig(path, c); err != nil {
			writeConfigError(w, http.StatusInternalServerError, fmt.Sprintf("寫入設定檔失敗:%v", err))
			return
		}
		appCfg, appCfgLoadError = c, ""
		writeLicenseJSON(w, http.StatusOK, map[string]any{
			"saved": c, "path": path,
			"restartRequired": c.AutoPort != autoPort || (!c.AutoPort && c.Port != port),
		})
	default:
		writeConfigError(w, http.StatusMethodNotAllowed, "不支援的請求方法")
	}
}

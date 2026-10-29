package app

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
	appCfgMu        sync.Mutex
)

type appConfigView struct {
	Path      string          `json:"path"`
	File      appConfig       `json:"file"`
	Effective effectiveConfig `json:"effective"`
	LoadError string          `json:"loadError"`
}

// effectiveConfig is the running config plus the LAN URLs of this machine.
type effectiveConfig struct {
	appConfig
	LanUrls []string `json:"lanUrls"`
}

// effectiveAppConfig reports the values this process is actually running with.
func effectiveAppConfig() appConfig {
	return appConfig{SavePcapng: !noPcapFile, SavePacketLog: savePacketLogRun, AutoOpenBrowser: !noBrowser, AutoPort: autoPort, Port: port, AllowLan: allowLan, DpsDisplay: dpsMode(appCfg.DpsDisplay), MemoryLimitMB: memoryLimitOrDefault(appCfg.MemoryLimitMB)}
}

func currentAppConfigView() appConfigView {
	appCfgMu.Lock()
	defer appCfgMu.Unlock()
	return appConfigView{
		Path: appConfigPath(), File: appCfg, Effective: effectiveConfig{effectiveAppConfig(), lanURLs(port)},
		LoadError: appCfgLoadError,
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
			SavePcapng      *bool   `json:"savePcapng"`
			SavePacketLog   *bool   `json:"savePacketLog"`
			AutoOpenBrowser *bool   `json:"autoOpenBrowser"`
			AutoPort        *bool   `json:"autoPort"`
			Port            *int    `json:"port"`
			AllowLan        *bool   `json:"allowLan"`
			DpsDisplay      *string `json:"dpsDisplay"`
			MemoryLimitMB   *int    `json:"memoryLimitMB"`
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
		c.TrayHintShown, c.Window, c.ChartWindows = appCfg.TrayHintShown, appCfg.Window, appCfg.ChartWindows // desktop state survives PUT
		c.OverlayHotkey, c.OverlayVisibleHotkey, c.Overlays = appCfg.OverlayHotkey, appCfg.OverlayVisibleHotkey, appCfg.Overlays
		c.UI = appCfg.UI
		if body.SavePacketLog != nil {
			c.SavePacketLog = *body.SavePacketLog
		} else {
			c.SavePacketLog = appCfg.SavePacketLog
		}
		if body.AllowLan != nil {
			c.AllowLan = *body.AllowLan
		} else {
			c.AllowLan = appCfg.AllowLan // omitted (e.g. a stale cached page): keep the stored value
		}
		if body.DpsDisplay != nil {
			c.DpsDisplay = *body.DpsDisplay
		} else {
			c.DpsDisplay = appCfg.DpsDisplay
		}
		if body.MemoryLimitMB != nil && *body.MemoryLimitMB != 0 {
			c.MemoryLimitMB = *body.MemoryLimitMB
		} else {
			c.MemoryLimitMB = appCfg.MemoryLimitMB
		}
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
		if pub := currentPub; pub != nil {
			pub.SetMemoryLimitMB(c.MemoryLimitMB)
		}
		broadcastConfigChanged(c)
		writeLicenseJSON(w, http.StatusOK, map[string]any{
			"saved": c, "path": path,
			"restartRequired": c.AutoPort != autoPort || (!c.AutoPort && c.Port != port) || c.AllowLan != allowLan,
		})
	default:
		writeConfigError(w, http.StatusMethodNotAllowed, "不支援的請求方法")
	}
}

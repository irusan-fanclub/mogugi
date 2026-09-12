package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/BurntSushi/toml"
)

const (
	appConfigFileName = "mogugi-config.toml"
	portMin           = 1024
	portMax           = 65535
)

// appConfig is the user-editable application config stored next to the exe.
// TOML tags name the file keys; JSON tags name the /api/config fields.
type appConfig struct {
	SavePcapng      bool `toml:"savePcapng" json:"savePcapng"`
	AutoOpenBrowser bool `toml:"autoOpenBrowser" json:"autoOpenBrowser"`
	AutoPort        bool `toml:"autoPort" json:"autoPort"`
	Port            int  `toml:"port" json:"port"`
}

func defaultAppConfig() appConfig {
	return appConfig{SavePcapng: false, AutoOpenBrowser: true, AutoPort: true, Port: 8030}
}

// appDirOverride replaces the executable-directory resolution in tests.
var appDirOverride string

// appDir follows license.dat's rule: MOGUGI_LICENSE_DIR, else the exe's directory.
func appDir() string {
	if appDirOverride != "" {
		return appDirOverride
	}
	if dir := strings.TrimSpace(os.Getenv("MOGUGI_LICENSE_DIR")); dir != "" {
		return dir
	}
	if exe, err := os.Executable(); err == nil {
		return filepath.Dir(exe)
	}
	return "."
}

func appConfigPath() string { return filepath.Join(appDir(), appConfigFileName) }

func validateAppConfig(c appConfig) error {
	if c.Port < portMin || c.Port > portMax {
		return fmt.Errorf("port 必須在 %d 到 %d 之間", portMin, portMax)
	}
	return nil
}

// parseAppConfig decodes the file text. Missing keys keep their defaults and
// unknown keys are ignored; a syntax/type error yields all defaults. The
// returned message is user-facing ("" = valid).
func parseAppConfig(text string) (appConfig, string) {
	text = strings.TrimPrefix(text, "\ufeff")
	var raw struct {
		SavePcapng      *bool `toml:"savePcapng"`
		AutoOpenBrowser *bool `toml:"autoOpenBrowser"`
		AutoPort        *bool `toml:"autoPort"`
		Port            *int  `toml:"port"`
	}
	if _, err := toml.Decode(text, &raw); err != nil {
		return defaultAppConfig(), fmt.Sprintf("設定檔格式錯誤:%v", err)
	}
	cfg := defaultAppConfig()
	if raw.SavePcapng != nil {
		cfg.SavePcapng = *raw.SavePcapng
	}
	if raw.AutoOpenBrowser != nil {
		cfg.AutoOpenBrowser = *raw.AutoOpenBrowser
	}
	if raw.AutoPort != nil {
		cfg.AutoPort = *raw.AutoPort
	}
	if raw.Port != nil {
		if err := validateAppConfig(appConfig{Port: *raw.Port}); err != nil {
			return cfg, fmt.Sprintf("%v,已改用 %d", err, cfg.Port)
		}
		cfg.Port = *raw.Port
	}
	return cfg, ""
}

// appConfigTemplate is the whole file: comments are re-emitted on every save.
const appConfigTemplate = `# mogugi 設定檔。改完存檔後重新啟動 mogugi 才會生效。
# 也可以在 mogugi 網頁的「設定」分頁修改,不必手動編輯。
# 這個檔案由 mogugi 產生;在分頁儲存時會整份重寫,只保留下列選項與說明。

# 是否保存封包原始紀錄(logs/packet_capture_*.pcapng)。
# 保留可以拿到其他家 DPS Meter 還原,但檔案會隨時間變大。true 或 false。
savePcapng = %t

# 啟動時是否自動開啟瀏覽器。true 或 false。
autoOpenBrowser = %t

# 自動切換 port:port 被占用時從 8030 往後試到 8040,並偵測已開啟的 mogugi。
# 開啟時下方的 port 設定無效。true 或 false。
autoPort = %t

# 網頁使用的 port。想同時開別家 DPS Meter 可以改,建議 8030 到 8040。
port = %d
`

// renderAppConfig prints the file from the template with CRLF line endings.
func renderAppConfig(c appConfig) string {
	s := fmt.Sprintf(appConfigTemplate, c.SavePcapng, c.AutoOpenBrowser, c.AutoPort, c.Port)
	return strings.ReplaceAll(s, "\n", "\r\n")
}

// loadAppConfig reads the file; a missing file is created with defaults,
// any other problem keeps the file untouched and reports it in loadError.
func loadAppConfig(path string) (cfg appConfig, loadError string, created bool) {
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		cfg = defaultAppConfig()
		if werr := saveAppConfig(path, cfg); werr != nil {
			return cfg, fmt.Sprintf("無法建立設定檔:%v", werr), false
		}
		return cfg, "", true
	}
	if err != nil {
		return defaultAppConfig(), fmt.Sprintf("無法讀取設定檔:%v", err), false
	}
	cfg, loadError = parseAppConfig(string(b))
	return cfg, loadError, false
}

// saveAppConfig validates, then writes via a uniquely-named temp file and
// rename so a failure never leaves a half-written config behind, and two
// concurrent saves never collide on the same temp path.
func saveAppConfig(path string, c appConfig) error {
	if err := validateAppConfig(c); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), appConfigFileName+".*.tmp")
	if err != nil {
		return err
	}
	tmp := f.Name()
	if _, err := f.WriteString(renderAppConfig(c)); err != nil {
		f.Close()
		os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Chmod(tmp, 0o644); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

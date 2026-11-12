package app

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/BurntSushi/toml"
)

const (
	DpsDisplayDesktop = "desktop"
	DpsDisplayWeb     = "web"
)

const (
	DefaultMemoryLimitMB = 150
	MinMemoryLimitMB     = 50
	MaxMemoryLimitMB     = 1000
)

const (
	appConfigFileName = "mogugi-config.toml"
	portMin           = 1024
	portMax           = 65535
)

// appConfig is the user-editable application config stored next to the exe.
// TOML tags name the file keys; JSON tags name the /api/config fields.
type appConfig struct {
	SavePcapng bool `toml:"savePcapng" json:"savePcapng"`
	// SavePacketLog writes logs/packet_log_*.ndjson; applies after a restart.
	SavePacketLog   bool `toml:"savePacketLog" json:"savePacketLog"`
	AutoOpenBrowser bool `toml:"autoOpenBrowser" json:"autoOpenBrowser"`
	AutoPort        bool `toml:"autoPort" json:"autoPort"`
	Port            int  `toml:"port" json:"port"`
	AllowLan        bool `toml:"allowLan" json:"allowLan"`
	// DpsDisplay is "desktop" (in-window UI) or "web" (also opens the browser UI).
	DpsDisplay string `toml:"dpsDisplay" json:"dpsDisplay"`
	// MemoryLimitMB caps the battle history kept in memory (0 = default).
	MemoryLimitMB int `toml:"memoryLimitMB" json:"memoryLimitMB"`

	// Desktop-shell internal state; kept out of the /api/config JSON.
	TrayHintShown bool        `toml:"trayHintShown" json:"-"`
	Window        WindowState `toml:"window" json:"-"`
	// ChartWindows remembers each chart kind's geometry (key = kind).
	ChartWindows map[string]WindowState `toml:"chartWindows" json:"-"`
	// OverlayHotkey is the lock-toggle hotkey ("" = DefaultOverlayHotkey).
	OverlayHotkey string `toml:"-" json:"-"`
	// OverlayVisibleHotkey is the show/hide hotkey ("" = DefaultOverlayVisibleHotkey).
	OverlayVisibleHotkey string `toml:"-" json:"-"`
	// Overlays remembers each overlay component's layout (key = id).
	Overlays map[string]OverlayLayout `toml:"overlays" json:"-"`
	// UI holds the frontend's settings tables ([battle], [ui]); see uiSettings.go.
	UI map[string]map[string]any `toml:"-" json:"-"`
}

// DefaultOverlayHotkey toggles the overlay locked/unlocked state.
const DefaultOverlayHotkey = "Ctrl+Alt+L"

// DefaultOverlayVisibleHotkey hides or shows every enabled overlay.
const DefaultOverlayVisibleHotkey = "Ctrl+Alt+O"

// OverlayLayout is one overlay component's persisted enable flag and placement:
// an anchor on the game window, an offset from it, a width and a row cap.
type OverlayLayout struct {
	Enabled bool   `toml:"enabled" json:"enabled"`
	Anchor  string `toml:"anchor" json:"anchor"`
	X       int    `toml:"x" json:"x"`
	Y       int    `toml:"y" json:"y"`
	Width   int    `toml:"width" json:"width"`
	MaxRows int    `toml:"maxRows" json:"maxRows"`
	// Dock names the component this one hangs under; X is then the offset from its left edge.
	Dock string `toml:"dock" json:"dock"`
	// Order lists the item ids of a section frame in display order.
	Order []string `toml:"order,omitempty" json:"order,omitempty"`
	// Frame is an opaque JSON record (name, title, look) written by the front end; Go never parses it.
	Frame string `toml:"frame,omitempty" json:"frame,omitempty"`
}

const maxOverlayOrder = 64

// maxOverlayFrame caps Frame in bytes.
const maxOverlayFrame = 2048

// overlayLayoutVersion is written next to [overlays]; layouts saved under an
// older version are dropped on load so everyone starts from the new defaults.
const overlayLayoutVersion = 2

// ValidOverlayLayout reports whether l has a known anchor and in-range size.
func ValidOverlayLayout(l OverlayLayout) bool {
	switch l.Anchor {
	case "tl", "tr", "bl", "br", "center":
	default:
		return false
	}
	if l.Dock != "" && !ValidOverlayID(l.Dock) {
		return false
	}
	if len(l.Order) > maxOverlayOrder || len(l.Frame) > maxOverlayFrame {
		return false
	}
	for _, id := range l.Order {
		if !ValidOverlayID(id) {
			return false
		}
	}
	return l.Width >= 120 && l.Width <= 800 && l.MaxRows >= 1 && l.MaxRows <= 20
}

// WindowState is the remembered main window geometry (zero Width = unset).
type WindowState struct {
	X         int  `toml:"x"`
	Y         int  `toml:"y"`
	Width     int  `toml:"width"`
	Height    int  `toml:"height"`
	Maximized bool `toml:"maximized"`
}

func defaultAppConfig() appConfig {
	return appConfig{SavePcapng: false, AutoOpenBrowser: true, AutoPort: true, Port: 8030, DpsDisplay: DpsDisplayDesktop, MemoryLimitMB: DefaultMemoryLimitMB}
}

func appConfigPath() string { return DataPath(appConfigFileName) }

func validateAppConfig(c appConfig) error {
	if c.Port < portMin || c.Port > portMax {
		return fmt.Errorf("port 必須在 %d 到 %d 之間", portMin, portMax)
	}
	if c.DpsDisplay != "" && c.DpsDisplay != DpsDisplayDesktop && c.DpsDisplay != DpsDisplayWeb {
		return fmt.Errorf("dpsDisplay 只能是 %q 或 %q", DpsDisplayDesktop, DpsDisplayWeb)
	}
	if c.MemoryLimitMB != 0 && (c.MemoryLimitMB < MinMemoryLimitMB || c.MemoryLimitMB > MaxMemoryLimitMB) {
		return fmt.Errorf("memoryLimitMB 必須在 %d 到 %d 之間", MinMemoryLimitMB, MaxMemoryLimitMB)
	}
	return nil
}

// parseAppConfig decodes the file text. Missing keys keep their defaults and
// unknown keys are ignored; a syntax/type error yields all defaults. The
// returned message is user-facing ("" = valid).
func parseAppConfig(text string) (appConfig, string) {
	text = strings.TrimPrefix(text, "\ufeff")
	var raw struct {
		SavePcapng      *bool                  `toml:"savePcapng"`
		SavePacketLog   *bool                  `toml:"savePacketLog"`
		AutoOpenBrowser *bool                  `toml:"autoOpenBrowser"`
		AutoPort        *bool                  `toml:"autoPort"`
		Port            *int                   `toml:"port"`
		AllowLan        *bool                  `toml:"allowLan"`
		DpsDisplay      *string                `toml:"dpsDisplay"`
		MemoryLimitMB   *int                   `toml:"memoryLimitMB"`
		TrayHintShown   *bool                  `toml:"trayHintShown"`
		Window          *WindowState           `toml:"window"`
		ChartWindows    map[string]WindowState `toml:"chartWindows"`
		Overlay         *struct {
			Hotkey        string `toml:"hotkey"`
			VisibleHotkey string `toml:"visibleHotkey"`
		} `toml:"overlay"`
		Overlays             map[string]OverlayLayout `toml:"overlays"`
		OverlayLayoutVersion int                      `toml:"overlayLayoutVersion"`
	}
	if _, err := toml.Decode(text, &raw); err != nil {
		return defaultAppConfig(), fmt.Sprintf("設定檔格式錯誤:%v", err)
	}
	var all map[string]any
	if _, err := toml.Decode(text, &all); err != nil {
		return defaultAppConfig(), fmt.Sprintf("設定檔格式錯誤:%v", err)
	}
	cfg := defaultAppConfig()
	if raw.SavePcapng != nil {
		cfg.SavePcapng = *raw.SavePcapng
	}
	if raw.SavePacketLog != nil {
		cfg.SavePacketLog = *raw.SavePacketLog
	}
	if raw.AutoOpenBrowser != nil {
		cfg.AutoOpenBrowser = *raw.AutoOpenBrowser
	}
	if raw.AutoPort != nil {
		cfg.AutoPort = *raw.AutoPort
	}
	if raw.AllowLan != nil {
		cfg.AllowLan = *raw.AllowLan
	}
	if raw.TrayHintShown != nil {
		cfg.TrayHintShown = *raw.TrayHintShown
	}
	if raw.Window != nil {
		cfg.Window = *raw.Window
	}
	if len(raw.ChartWindows) > 0 {
		cfg.ChartWindows = raw.ChartWindows
	}
	if raw.Overlay != nil {
		cfg.OverlayHotkey = raw.Overlay.Hotkey
		cfg.OverlayVisibleHotkey = raw.Overlay.VisibleHotkey
	}
	for id, l := range raw.Overlays {
		if raw.OverlayLayoutVersion == overlayLayoutVersion && ValidOverlayLayout(l) {
			if cfg.Overlays == nil {
				cfg.Overlays = map[string]OverlayLayout{}
			}
			cfg.Overlays[id] = l
		}
	}
	cfg.UI = parseUiSettings(all)
	// An invalid value falls back to its default; the other keys still apply.
	msg := ""
	if raw.DpsDisplay != nil {
		if err := validateAppConfig(appConfig{Port: portMin, DpsDisplay: *raw.DpsDisplay}); err != nil {
			msg = fmt.Sprintf("%v,已改用 %q", err, cfg.DpsDisplay)
		} else {
			cfg.DpsDisplay = *raw.DpsDisplay
		}
	}
	if raw.MemoryLimitMB != nil {
		if err := validateAppConfig(appConfig{Port: portMin, MemoryLimitMB: *raw.MemoryLimitMB}); err != nil {
			if msg == "" {
				msg = fmt.Sprintf("%v,已改用 %d", err, cfg.MemoryLimitMB)
			}
		} else if *raw.MemoryLimitMB != 0 {
			cfg.MemoryLimitMB = *raw.MemoryLimitMB
		}
	}
	if raw.Port != nil {
		if err := validateAppConfig(appConfig{Port: *raw.Port}); err != nil {
			if msg == "" {
				msg = fmt.Sprintf("%v,已改用 %d", err, cfg.Port)
			}
		} else {
			cfg.Port = *raw.Port
		}
	}
	return cfg, msg
}

// appConfigTemplate is the whole file: comments are re-emitted on every save.
const appConfigTemplate = `# mogugi 設定檔。改完存檔後重新啟動 mogugi 才會生效。
# 也可以在 mogugi 網頁的「設定」分頁修改,不必手動編輯。
# 這個檔案由 mogugi 產生;在分頁儲存時會整份重寫,只保留下列選項與說明。

# 是否保存封包原始紀錄(logs/packet_capture_*.pcapng)。
# 保留可以拿到其他家 DPS Meter 還原,但檔案會隨時間變大。true 或 false。
savePcapng = %t

# 是否保存除錯用的封包紀錄(logs/packet_log_*.ndjson)。
# 回報問題時可附上;檔案會隨時間變大。改完需重新啟動。true 或 false。
savePacketLog = %t

# 啟動時是否自動開啟瀏覽器。true 或 false。
autoOpenBrowser = %t

# 自動切換 port:port 被占用時從 8030 往後試到 8040,並偵測已開啟的 mogugi。
# 開啟時下方的 port 設定無效。true 或 false。
autoPort = %t

# 網頁使用的 port。想同時開別家 DPS Meter 可以改,建議 8030 到 8040。
port = %d

# 是否允許區網內其他裝置連線（聽 0.0.0.0）。預設 false 只允許本機。true 或 false。
# 改完需重新啟動。
allowLan = %t

# DPS 顯示方式："desktop" 在桌面視窗內顯示，"web" 改在瀏覽器顯示（桌面視窗變成控制面板）。
dpsDisplay = "%s"

# 戰鬥資料記憶體上限（MB）。超過時從最舊的一場戰鬥開始回收。50 到 1000。
memoryLimitMB = %d

# 以下由 mogugi 自動維護，不需要手動修改。
trayHintShown = %t
overlayLayoutVersion = %d
`

// dpsMode maps an unset value to the default mode.
func dpsMode(v string) string {
	if v == "" {
		return DpsDisplayDesktop
	}
	return v
}

// memoryLimitOrDefault maps an unset value to the default limit.
func memoryLimitOrDefault(mb int) int {
	if mb == 0 {
		return DefaultMemoryLimitMB
	}
	return mb
}

// renderAppConfig prints the file from the template with CRLF line endings.
func renderAppConfig(c appConfig) string {
	s := fmt.Sprintf(appConfigTemplate, c.SavePcapng, c.SavePacketLog, c.AutoOpenBrowser, c.AutoPort, c.Port, c.AllowLan, dpsMode(c.DpsDisplay), memoryLimitOrDefault(c.MemoryLimitMB), c.TrayHintShown, overlayLayoutVersion)
	if w := c.Window; w.Width > 0 {
		s += fmt.Sprintf("\n[window]\nx = %d\ny = %d\nwidth = %d\nheight = %d\nmaximized = %t\n", w.X, w.Y, w.Width, w.Height, w.Maximized)
	}
	kinds := make([]string, 0, len(c.ChartWindows))
	for k, w := range c.ChartWindows {
		if w.Width > 0 && bareTomlKey.MatchString(k) {
			kinds = append(kinds, k)
		}
	}
	sort.Strings(kinds)
	for _, k := range kinds {
		w := c.ChartWindows[k]
		s += fmt.Sprintf("\n[chartWindows.%s]\nx = %d\ny = %d\nwidth = %d\nheight = %d\nmaximized = %t\n", k, w.X, w.Y, w.Width, w.Height, w.Maximized)
	}
	h, vh := c.OverlayHotkey, c.OverlayVisibleHotkey
	if h == DefaultOverlayHotkey {
		h = ""
	}
	if vh == DefaultOverlayVisibleHotkey {
		vh = ""
	}
	if h != "" || vh != "" {
		s += "\n[overlay]\n"
		if h != "" {
			s += fmt.Sprintf("hotkey = %q\n", h)
		}
		if vh != "" {
			s += fmt.Sprintf("visibleHotkey = %q\n", vh)
		}
	}
	ids := make([]string, 0, len(c.Overlays))
	for id, o := range c.Overlays {
		if ValidOverlayLayout(o) && bareTomlKey.MatchString(id) {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		o := c.Overlays[id]
		s += fmt.Sprintf("\n[overlays.%s]\nenabled = %t\nanchor = %q\nx = %d\ny = %d\nwidth = %d\nmaxRows = %d\n", id, o.Enabled, o.Anchor, o.X, o.Y, o.Width, o.MaxRows)
		if o.Dock != "" {
			s += fmt.Sprintf("dock = %q\n", o.Dock)
		}
		if len(o.Order) > 0 {
			s += fmt.Sprintf("order = [%s]\n", quoteJoin(o.Order))
		}
		if o.Frame != "" {
			s += "frame = " + tomlString(o.Frame) + "\n"
		}
	}
	s += renderUiSettings(c.UI)
	return strings.ReplaceAll(s, "\n", "\r\n")
}

// tomlString renders s as a TOML basic string; %q would emit \x, \a and \v, which TOML rejects.
func tomlString(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch {
		case r == '"' || r == '\\':
			b.WriteByte('\\')
			b.WriteRune(r)
		case r == '\n':
			b.WriteString(`\n`)
		case r == '\t':
			b.WriteString(`\t`)
		case r == '\r':
			b.WriteString(`\r`)
		case r < 0x20 || r == 0x7f:
			fmt.Fprintf(&b, `\u%04x`, r)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

// quoteJoin renders strings as a comma-separated list of TOML basic strings.
func quoteJoin(ss []string) string {
	q := make([]string, len(ss))
	for i, s := range ss {
		q[i] = fmt.Sprintf("%q", s)
	}
	return strings.Join(q, ", ")
}

// bareTomlKey limits chartWindows and overlays keys to ones safe to print unquoted.
var bareTomlKey = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// ValidOverlayID reports whether id can be an [overlays.<id>] table name.
func ValidOverlayID(id string) bool { return bareTomlKey.MatchString(id) }

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

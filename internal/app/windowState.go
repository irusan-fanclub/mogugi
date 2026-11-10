package app

import "fmt"

// updateAppConfig runs the load/modify/save path under appCfgMu so desktop
// state writes never clobber a concurrent PUT /api/config.
func updateAppConfig(mod func(*appConfig)) error {
	appCfgMu.Lock()
	defer appCfgMu.Unlock()
	if appCfgLoadError != "" {
		return fmt.Errorf("設定檔有問題，略過寫入：%s", appCfgLoadError)
	}
	c := appCfg
	mod(&c)
	if err := saveAppConfig(appConfigPath(), c); err != nil {
		return err
	}
	appCfg = c
	return nil
}

// LoadDesktopState returns the remembered window geometry and tray-hint flag.
func LoadDesktopState() (WindowState, bool) {
	appCfgMu.Lock()
	defer appCfgMu.Unlock()
	return appCfg.Window, appCfg.TrayHintShown
}

// SaveWindowState persists the main window geometry.
func SaveWindowState(w WindowState) error {
	return updateAppConfig(func(c *appConfig) { c.Window = w })
}

// MarkTrayHintShown records that the close-to-tray hint was acknowledged.
func MarkTrayHintShown() error {
	return updateAppConfig(func(c *appConfig) { c.TrayHintShown = true })
}

// SaveChartWindowState persists one chart kind's window geometry.
func SaveChartWindowState(kind string, w WindowState) error {
	return updateAppConfig(func(c *appConfig) {
		m := make(map[string]WindowState, len(c.ChartWindows)+1)
		for k, v := range c.ChartWindows {
			m[k] = v
		}
		m[kind] = w
		c.ChartWindows = m
	})
}

// LoadChartWindowStates returns a copy of the remembered chart geometries.
func LoadChartWindowStates() map[string]WindowState {
	appCfgMu.Lock()
	defer appCfgMu.Unlock()
	out := make(map[string]WindowState, len(appCfg.ChartWindows))
	for k, v := range appCfg.ChartWindows {
		out[k] = v
	}
	return out
}

// SaveOverlayLayout persists one overlay component's layout.
func SaveOverlayLayout(id string, l OverlayLayout) error {
	return updateAppConfig(func(c *appConfig) {
		m := make(map[string]OverlayLayout, len(c.Overlays)+1)
		for k, v := range c.Overlays {
			m[k] = v
		}
		m[id] = l
		c.Overlays = m
	})
}

// ReplaceOverlayLayouts applies removes then saves in one config write.
func ReplaceOverlayLayouts(saves map[string]OverlayLayout, removes []string) error {
	return updateAppConfig(func(c *appConfig) {
		m := make(map[string]OverlayLayout, len(c.Overlays)+len(saves))
		for k, v := range c.Overlays {
			m[k] = v
		}
		for _, id := range removes {
			delete(m, id)
		}
		for id, l := range saves {
			m[id] = l
		}
		c.Overlays = m
	})
}

// RemoveOverlayLayout drops one component's stored layout.
func RemoveOverlayLayout(id string) error {
	return updateAppConfig(func(c *appConfig) {
		m := make(map[string]OverlayLayout, len(c.Overlays))
		for k, v := range c.Overlays {
			if k != id {
				m[k] = v
			}
		}
		c.Overlays = m
	})
}

// SaveOverlayHotkey persists the lock-toggle hotkey.
func SaveOverlayHotkey(h string) error {
	return updateAppConfig(func(c *appConfig) { c.OverlayHotkey = h })
}

// SaveOverlayVisibleHotkey persists the show/hide hotkey.
func SaveOverlayVisibleHotkey(h string) error {
	return updateAppConfig(func(c *appConfig) { c.OverlayVisibleHotkey = h })
}

// LoadOverlayConfig returns the lock and show/hide hotkeys (defaults if unset)
// and a copy of the remembered overlay layouts.
func LoadOverlayConfig() (hotkey, visibleHotkey string, layouts map[string]OverlayLayout) {
	appCfgMu.Lock()
	defer appCfgMu.Unlock()
	hotkey = appCfg.OverlayHotkey
	if hotkey == "" {
		hotkey = DefaultOverlayHotkey
	}
	visibleHotkey = appCfg.OverlayVisibleHotkey
	if visibleHotkey == "" {
		visibleHotkey = DefaultOverlayVisibleHotkey
	}
	layouts = make(map[string]OverlayLayout, len(appCfg.Overlays))
	for k, v := range appCfg.Overlays {
		layouts[k] = v
	}
	return hotkey, visibleHotkey, layouts
}

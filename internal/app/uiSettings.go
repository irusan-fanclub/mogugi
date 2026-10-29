package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/BurntSushi/toml"
)

// The frontend's settings, kept in mogugi-config.toml under the tables below.
// The frontend owns their shape; the file only stores them as plain TOML values.

const uiSettingsMaxBytes = 256 * 1024

// uiSections lists the tables, in file order, with the comment printed above each.
var uiSections = []struct{ name, comment string }{
	{"battle", "戰鬥分頁的設定"},
	{"ui", "其他介面設定（浮動視窗外觀、欄位顯示等）"},
}

func isUiSection(name string) bool {
	for _, s := range uiSections {
		if s.name == name {
			return true
		}
	}
	return false
}

// renderUiSettings prints every non-empty table (nested maps become
// [section.x] sub-tables).
func renderUiSettings(ui map[string]map[string]any) string {
	out := ""
	for _, s := range uiSections {
		m := ui[s.name]
		if len(m) == 0 {
			continue
		}
		var b bytes.Buffer
		enc := toml.NewEncoder(&b)
		enc.Indent = ""
		if err := enc.Encode(map[string]any{s.name: m}); err != nil {
			logger.Printf("render [%s] settings: %v", s.name, err)
			continue
		}
		out += "\n# " + s.comment + "，由 mogugi 維護。要手動修改請先關閉 mogugi，否則會被覆蓋。\n" + b.String()
	}
	return out
}

// parseUiSettings picks the known tables out of the whole decoded file.
func parseUiSettings(all map[string]any) map[string]map[string]any {
	var ui map[string]map[string]any
	for _, s := range uiSections {
		if m, ok := all[s.name].(map[string]any); ok && len(m) > 0 {
			if ui == nil {
				ui = map[string]map[string]any{}
			}
			ui[s.name] = m
		}
	}
	return ui
}

// normalizeJSON turns json.Number into int64 (or float64 when fractional), so
// TOML keeps 803 rather than 803.0, and walks maps and arrays.
func normalizeJSON(v any) any {
	switch x := v.(type) {
	case json.Number:
		if i, err := x.Int64(); err == nil {
			return i
		}
		f, _ := x.Float64()
		return f
	case map[string]any:
		for k, e := range x {
			x[k] = normalizeJSON(e)
		}
		return x
	case []any:
		for i, e := range x {
			x[i] = normalizeJSON(e)
		}
		return x
	}
	return v
}

// httpHandlerUiSettings serves GET {"battle": {...}, "ui": {...}}; a PUT of
// the same shape replaces each table it names and keeps the others.
func httpHandlerUiSettings(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		appCfgMu.Lock()
		out := map[string]any{}
		for _, s := range uiSections {
			m := appCfg.UI[s.name]
			if m == nil {
				m = map[string]any{}
			}
			out[s.name] = m
		}
		appCfgMu.Unlock()
		writeLicenseJSON(w, http.StatusOK, out)
	case http.MethodPut:
		b, err := io.ReadAll(io.LimitReader(r.Body, uiSettingsMaxBytes+1))
		if err != nil || len(b) > uiSettingsMaxBytes {
			writeConfigError(w, http.StatusBadRequest, "設定內容過大")
			return
		}
		dec := json.NewDecoder(strings.NewReader(string(b)))
		dec.UseNumber()
		var body map[string]any
		if err := dec.Decode(&body); err != nil || len(body) == 0 {
			writeConfigError(w, http.StatusBadRequest, "設定內容不完整")
			return
		}
		tables := map[string]map[string]any{}
		for k, v := range body {
			m, ok := v.(map[string]any)
			if !ok || !isUiSection(k) {
				writeConfigError(w, http.StatusBadRequest, "設定內容不完整")
				return
			}
			tables[k] = normalizeJSON(m).(map[string]any)
		}
		err = updateAppConfig(func(c *appConfig) {
			next := map[string]map[string]any{}
			for k, m := range c.UI {
				next[k] = m
			}
			for k, m := range tables {
				next[k] = m
			}
			c.UI = next
		})
		if err != nil {
			writeConfigError(w, http.StatusInternalServerError, fmt.Sprintf("寫入設定檔失敗:%v", err))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

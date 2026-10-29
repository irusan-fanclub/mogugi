package app

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const battleBody = `{"battle":{"bossCC":[803,1026],"ccPickMode":"icon","general":{"hpGuideStep":25,"showHpRuler":true,"hiddenTargetRaces":[]},` +
	`"skillCc":{"common":{"boss":[1026],"self":[516]},"arcana":{"1":{"boss":[],"self":[323]}}}},` +
	`"ui":{"importBattles":true,"overlay":{"dps":{"opacity":60}}}}`

func putUiSettings(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	rr := httptest.NewRecorder()
	httpHandlerUiSettings(rr, httptest.NewRequest("PUT", "/api/ui-settings", strings.NewReader(body)))
	return rr
}

// The tables are written as plain TOML (integers stay integers) and reads back the same.
func TestUiSettingsRoundTripThroughTheConfigFile(t *testing.T) {
	dir := withAppConfigDir(t)
	if rr := putUiSettings(t, battleBody); rr.Code != 204 {
		t.Fatalf("PUT code=%d body=%s", rr.Code, rr.Body.String())
	}
	b, err := os.ReadFile(filepath.Join(dir, appConfigFileName))
	if err != nil {
		t.Fatal(err)
	}
	text := string(b)
	for _, want := range []string{"[battle]", "bossCC = [803, 1026]", `ccPickMode = "icon"`, "[battle.skillCc.arcana.1]", "hpGuideStep = 25", "[ui]", "importBattles = true", "[ui.overlay.dps]"} {
		if !strings.Contains(text, want) {
			t.Fatalf("file lacks %q:\n%s", want, text)
		}
	}
	cfg, msg := parseAppConfig(text)
	if msg != "" {
		t.Fatal(msg)
	}
	appCfg = cfg
	rr := httptest.NewRecorder()
	httpHandlerUiSettings(rr, httptest.NewRequest("GET", "/api/ui-settings", nil))
	var got, want map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &got); err != nil {
		t.Fatal(err)
	}
	_ = json.Unmarshal([]byte(battleBody), &want)
	gotJSON, _ := json.Marshal(got)
	wantJSON, _ := json.Marshal(want)
	if string(gotJSON) != string(wantJSON) {
		t.Fatalf("round trip:\n got %s\nwant %s", gotJSON, wantJSON)
	}
}

func TestUiSettingsRejectsBadBodies(t *testing.T) {
	withAppConfigDir(t)
	for _, body := range []string{`{}`, `not json`, `{"battle":[1]}`, `{"overlays":{}}`, `{"battle":{"x":"` + strings.Repeat("a", uiSettingsMaxBytes) + `"}}`} {
		if rr := putUiSettings(t, body); rr.Code != 400 {
			t.Fatalf("%.30q: code=%d", body, rr.Code)
		}
	}
}

// Saving the settings tab must not drop the battle tab's table.
func TestConfigPutKeepsBattleSettings(t *testing.T) {
	withAppConfigDir(t)
	if rr := putUiSettings(t, battleBody); rr.Code != 204 {
		t.Fatalf("PUT ui-settings code=%d", rr.Code)
	}
	if rr := putConfig(t, `{"savePcapng":true,"autoOpenBrowser":false,"autoPort":true,"port":8030}`); rr.Code != 200 {
		t.Fatalf("PUT config code=%d body=%s", rr.Code, rr.Body.String())
	}
	if appCfg.UI["battle"]["ccPickMode"] != "icon" || appCfg.UI["ui"]["importBattles"] != true {
		t.Fatalf("ui settings lost: %v", appCfg.UI)
	}
}

// A PUT naming one table keeps the others.
func TestUiSettingsPutKeepsOtherTables(t *testing.T) {
	withAppConfigDir(t)
	if rr := putUiSettings(t, battleBody); rr.Code != 204 {
		t.Fatalf("PUT code=%d", rr.Code)
	}
	if rr := putUiSettings(t, `{"ui":{"importBattles":false}}`); rr.Code != 204 {
		t.Fatalf("PUT code=%d", rr.Code)
	}
	if appCfg.UI["battle"]["ccPickMode"] != "icon" || appCfg.UI["ui"]["importBattles"] != false {
		t.Fatalf("got %v", appCfg.UI)
	}
}

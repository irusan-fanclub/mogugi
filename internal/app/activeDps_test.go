package app

import (
	"encoding/json"
	"math"
	"os"
	"reflect"
	"testing"
)

func TestActiveDpsFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/active_dps_fixture.json")
	if err != nil {
		t.Fatal(err)
	}
	var fx struct {
		Cases []struct {
			Name           string
			Toggles        []ccToggle
			EndSec         int64
			FightStart     int64
			Windows        []span
			Hits           []hitRec
			Deaths         []deathToggle
			WantInvincible []span
			WantDeaths     []span
			WantActiveDps  *float64
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &fx); err != nil {
		t.Fatal(err)
	}
	if len(fx.Cases) == 0 {
		t.Fatal("no fixture cases")
	}
	for _, c := range fx.Cases {
		t.Run(c.Name, func(t *testing.T) {
			inv := invincibleWindows(c.Toggles, c.EndSec)
			if len(inv) == 0 && len(c.WantInvincible) == 0 {
				// nil and empty are equivalent
			} else if !reflect.DeepEqual(inv, c.WantInvincible) {
				t.Fatalf("invincible = %v, want %v", inv, c.WantInvincible)
			}
			deaths := deathSpans(c.Deaths, c.EndSec)
			if len(deaths) != 0 || len(c.WantDeaths) != 0 {
				if !reflect.DeepEqual(deaths, c.WantDeaths) {
					t.Fatalf("deaths = %v, want %v", deaths, c.WantDeaths)
				}
			}
			got, ok := activeDps(c.Hits, c.Windows, excludedSpans(c.FightStart, append(inv, deaths...)))
			if c.WantActiveDps == nil {
				if ok {
					t.Fatalf("want !ok, got %v", got)
				}
				return
			}
			if !ok || math.Abs(got-*c.WantActiveDps) > 1e-9 {
				t.Fatalf("activeDps = %v,%v want %v", got, ok, *c.WantActiveDps)
			}
		})
	}
}

package desktop

import (
	"net/url"
	"reflect"
	"sort"
	"testing"
)

func TestChartURLEncodes(t *testing.T) {
	spec := `{"a":"b c"}`
	title := "累計傷害 & 圖表"
	u := chartURL("dps-1", "dps", spec, title)
	p, err := url.Parse(u)
	if err != nil || p.Path != "/chart.html" {
		t.Fatalf("u=%q err=%v", u, err)
	}
	q := p.Query()
	if q.Get("id") != "dps-1" || q.Get("kind") != "dps" || q.Get("spec") != spec || q.Get("title") != title {
		t.Fatalf("query=%v", q)
	}
}

func TestValidChartOpen(t *testing.T) {
	good := map[string]any{"id": "dps-1", "kind": "hitlog", "title": "T", "spec": "{}"}
	r, ok := validChartOpen(good)
	if !ok || r.ID != "dps-1" || r.Kind != "hitlog" || r.Title != "T" || r.Spec != "{}" {
		t.Fatalf("got %+v ok=%v", r, ok)
	}
	with := func(k string, v any) map[string]any {
		m := map[string]any{}
		for a, b := range good {
			m[a] = b
		}
		if v == nil {
			delete(m, k)
		} else {
			m[k] = v
		}
		return m
	}
	bad := map[string]map[string]any{
		"upper id":     with("id", "Dps"),
		"traversal":    with("id", "../x"),
		"empty id":     with("id", ""),
		"long id":      with("id", string(make([]byte, 41))),
		"bad kind":     with("kind", "foo"),
		"missing spec": with("spec", nil),
		"spec type":    with("spec", 5),
	}
	for name, m := range bad {
		if _, ok := validChartOpen(m); ok {
			t.Errorf("%s: accepted", name)
		}
	}
	for _, k := range []string{"condition", "hitlog"} {
		if _, ok := validChartOpen(with("kind", k)); !ok {
			t.Errorf("kind %s rejected", k)
		}
	}
	for _, k := range []string{"cumulative", "dps", "count", "distribution"} {
		if _, ok := validChartOpen(with("kind", k)); ok {
			t.Errorf("removed kind %s accepted", k)
		}
	}
}

func TestChartRegistry(t *testing.T) {
	var r chartRegistry
	if r.has("a") || len(r.all()) != 0 {
		t.Fatal("not empty")
	}
	r.add("b")
	r.add("a")
	r.add("a")
	if !r.has("a") || !r.has("b") {
		t.Fatal("missing")
	}
	got := r.all()
	sort.Strings(got)
	if !reflect.DeepEqual(got, []string{"a", "b"}) {
		t.Fatalf("all=%v", got)
	}
	r.remove("a")
	if r.has("a") || !r.has("b") {
		t.Fatal("remove failed")
	}
}

func TestClampChartState(t *testing.T) {
	screens := []rect{{0, 0, 1920, 1080}}
	if got := clampState(windowState{}, screens, chartLimits); got.Width != 640 || got.Height != 420 || got.X != 640 || got.Y != 330 {
		t.Fatalf("unset: %+v", got)
	}
	keep := windowState{X: 100, Y: 100, Width: 500, Height: 300}
	if got := clampState(keep, screens, chartLimits); got != keep {
		t.Fatalf("small saved size must survive: %+v", got)
	}
	off := windowState{X: 5000, Y: 5000, Width: 500, Height: 300}
	if got := clampState(off, screens, chartLimits); got.X != 710 || got.Y != 390 {
		t.Fatalf("off-screen: %+v", got)
	}
	if got := clampState(windowState{X: 0, Y: 0, Width: 100, Height: 100}, screens, chartLimits); got.Width != 640 {
		t.Fatalf("too small: %+v", got)
	}
}

func TestCascadeState(t *testing.T) {
	s := windowState{X: 100, Y: 50, Width: 640, Height: 420}
	if got := cascadeState(s, 0); got != s {
		t.Fatalf("no open windows must not move: %+v", got)
	}
	if got := cascadeState(s, 2); got.X != 160 || got.Y != 110 || got.Width != 640 {
		t.Fatalf("two open windows: %+v", got)
	}
	if got := cascadeState(windowState{}, 3); got != (windowState{}) {
		t.Fatalf("unsaved state must stay centred: %+v", got)
	}
}

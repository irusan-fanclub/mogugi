package desktop

import (
	"reflect"
	"strings"
	"testing"

	"github.com/irusan-fanclub/mogugi/internal/app"
)

func TestParseLayoutOversizedFrameInvalid(t *testing.T) {
	l, ok := parseLayout(layoutPayload(map[string]any{"frame": strings.Repeat("a", 2049)}))
	if !ok || app.ValidOverlayLayout(l) {
		t.Fatalf("ok=%v valid=%v", ok, app.ValidOverlayLayout(l))
	}
}

func layoutPayload(extra map[string]any) map[string]any {
	m := map[string]any{"enabled": true, "anchor": "tl", "x": 1.0, "y": 2.0, "width": 260.0, "maxRows": 8.0}
	for k, v := range extra {
		m[k] = v
	}
	return m
}

func TestParseReplacePayload(t *testing.T) {
	saves, removes := parseReplacePayload(map[string]any{
		"saves":   map[string]any{"a": layoutPayload(nil), "bad": map[string]any{"enabled": 1.0}, "notObj": 3.0},
		"removes": []any{"x", 4.0, "y"},
	})
	if len(saves) != 1 || saves["a"].Width != 260 || !reflect.DeepEqual(removes, []string{"x", "y"}) {
		t.Fatalf("saves=%+v removes=%v", saves, removes)
	}
	saves, removes = parseReplacePayload("nope")
	if len(saves) != 0 || len(removes) != 0 {
		t.Fatalf("garbage accepted: %+v %v", saves, removes)
	}
	saves, removes = parseReplacePayload(map[string]any{"saves": "x", "removes": "y"})
	if len(saves) != 0 || len(removes) != 0 {
		t.Fatalf("wrong types accepted: %+v %v", saves, removes)
	}
}

func TestParseLayoutOrder(t *testing.T) {
	l, ok := parseLayout(layoutPayload(map[string]any{"order": []any{"1164", "1165"}}))
	if !ok || !reflect.DeepEqual(l.Order, []string{"1164", "1165"}) {
		t.Fatalf("ok=%v order=%v", ok, l.Order)
	}
	l, ok = parseLayout(layoutPayload(nil))
	if !ok || l.Order != nil {
		t.Fatalf("missing order: ok=%v order=%v", ok, l.Order)
	}
	if _, ok = parseLayout(layoutPayload(map[string]any{"order": []any{"x", 3.0}})); ok {
		t.Fatal("non-string order entry accepted")
	}
	if _, ok = parseLayout(layoutPayload(map[string]any{"order": "x"})); ok {
		t.Fatal("non-array order accepted")
	}
}

func TestParseLayoutFrame(t *testing.T) {
	l, ok := parseLayout(layoutPayload(map[string]any{"frame": `{"n":1}`}))
	if !ok || l.Frame != `{"n":1}` {
		t.Fatalf("ok=%v frame=%q", ok, l.Frame)
	}
	l, ok = parseLayout(layoutPayload(nil))
	if !ok || l.Frame != "" {
		t.Fatalf("missing frame: ok=%v frame=%q", ok, l.Frame)
	}
	if _, ok = parseLayout(layoutPayload(map[string]any{"frame": 3.0})); ok {
		t.Fatal("non-string frame accepted")
	}
}

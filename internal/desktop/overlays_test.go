package desktop

import (
	"reflect"
	"testing"
)

func layoutPayload(extra map[string]any) map[string]any {
	m := map[string]any{"enabled": true, "anchor": "tl", "x": 1.0, "y": 2.0, "width": 260.0, "maxRows": 8.0}
	for k, v := range extra {
		m[k] = v
	}
	return m
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

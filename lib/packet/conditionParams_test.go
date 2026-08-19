package packet

import "testing"

func TestParseConditionParams(t *testing.T) {
	got := ParseConditionParams("MCMBAMIN:f:32.200001;MCMBGA:b:false;SBT:8:63922323583596;")
	want := map[string]string{
		"MCMBAMIN": "32.200001",
		"MCMBGA":   "false",
		"SBT":      "63922323583596",
	}
	if len(got) != len(want) {
		t.Fatalf("got %d keys, want %d: %v", len(got), len(want), got)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %q, want %q", k, got[k], v)
		}
	}
}

// A value may itself contain a colon; only the first two are separators.
func TestParseConditionParamsKeepsColonsInValue(t *testing.T) {
	got := ParseConditionParams("K:s:a:b:c;")
	if got["K"] != "a:b:c" {
		t.Fatalf("K = %q, want %q", got["K"], "a:b:c")
	}
}

func TestParseConditionParamsIgnoresMalformed(t *testing.T) {
	got := ParseConditionParams("OK:f:1;garbage;ALSO:f:2;")
	if len(got) != 2 || got["OK"] != "1" || got["ALSO"] != "2" {
		t.Fatalf("got %v, want the two well-formed entries only", got)
	}
}

func TestParseConditionParamsEmpty(t *testing.T) {
	if got := ParseConditionParams(""); len(got) != 0 {
		t.Fatalf("got %v, want empty", got)
	}
}

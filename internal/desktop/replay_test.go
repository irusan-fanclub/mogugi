package desktop

import (
	"strings"
	"testing"
)

func TestImportBattlesFrom(t *testing.T) {
	cases := []struct {
		in   any
		want bool
	}{
		{map[string]any{"importBattles": true}, true},
		{map[string]any{"importBattles": false}, false},
		{map[string]any{}, false},
		{nil, false},
		{"x", false},
	}
	for _, c := range cases {
		if got := importBattlesFrom(c.in); got != c.want {
			t.Errorf("%v: got %v", c.in, got)
		}
	}
}

func TestReplayFilterAcceptsGzRecords(t *testing.T) {
	if !strings.Contains(replayFilterPattern, "*.ndjson.gz") {
		t.Fatalf("filter %q must accept *.ndjson.gz", replayFilterPattern)
	}
}

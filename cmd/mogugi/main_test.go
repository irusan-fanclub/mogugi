package main

import (
	"strings"
	"testing"
)

// Every launch flag and mode must be explained in the usage text — this is
// the only documentation the exe carries.
func TestUsageTextCoversFlagsAndModes(t *testing.T) {
	u := usageText()
	for _, want := range []string{
		"--no-pcap", "--no-browser", "--realtime",
		"file", "list", "itemcsv", "--help",
	} {
		if !strings.Contains(u, want) {
			t.Errorf("usage text lacks %q", want)
		}
	}
}

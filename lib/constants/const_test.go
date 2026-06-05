package constants

import (
	"strings"
	"testing"
)

func TestRebuildFilter_MatchesPlainAndPPPoE(t *testing.T) {
	ServerIP = "1.2.3.4"
	ServerSrcPort = "11022"
	ServerDstPort = "54321"
	defer func() {
		ServerIP, ServerSrcPort, ServerDstPort = "", "", ""
		RebuildFilter()
	}()

	RebuildFilter()
	got := PCAP_GAMESERVER_FILTER

	// Must scope to the discovered connection.
	for _, want := range []string{"src net 1.2.3.4", "src port (11022)", "dst port (54321)"} {
		if !strings.Contains(got, want) {
			t.Fatalf("filter %q missing %q", got, want)
		}
	}
	// Must also match PPPoE-encapsulated traffic (中華電信 寬頻 / dial-up).
	if !strings.Contains(got, "pppoes") {
		t.Fatalf("filter %q missing pppoes clause", got)
	}
}

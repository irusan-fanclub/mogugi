package constants

import (
	"fmt"
	"time"
)

var PCAP_GAMESERVER_FILTER = ""

// Server IP / port defaults are intentionally empty: pcaputil.FindNic
// discovers the live Client.exe connection at startup and writes these
// via ApplyConnectionFilter. Hard-coded server addresses (KR / Gearup
// Taiwan / etc.) used to live here but are no longer needed.
var ServerIP = ""
var ServerSrcPort = ""
var ServerDstPort = ""

func init() {
	RebuildFilter()
}

// RebuildFilter rebuilds the pcap BPF filter from the current settings.
// Since the filter is scoped to the game server IP and port, TLS traffic
// never reaches this capture and no extra content-type filtering is needed.
func RebuildFilter() {
	filter := fmt.Sprintf("tcp and src net %s and src port (%s) and dst port (%s)", ServerIP, ServerSrcPort, ServerDstPort)
	PCAP_GAMESERVER_FILTER = filter
}

var SERVER_START_AT = time.Now().Unix()

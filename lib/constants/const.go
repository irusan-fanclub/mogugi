package constants

import (
	"fmt"
	"time"
)

var PCAP_GAMESERVER_FILTER = ""

// kr server
// const _SERVER_MABI_KR = "211.218.233.0/24"
// const _PORT_MABI_KR = "11020 or 11021 or 11023"

// Gearup Taiwan server (Taiwan 15) - default values
var ServerIP = "210.208.80.0/24"
var ServerSrcPort = ""
var ServerDstPort = "11022 or 59062"

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

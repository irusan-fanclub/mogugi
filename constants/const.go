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

// RebuildFilter rebuilds the PCAP filter with current settings
func RebuildFilter() {
	// Filter for Mabi server or Gearup server
	// Also filter out TLS packets (content type 0x14-0x17) by checking first byte of TCP payload
	tlsFilter := "(tcp[((tcp[12:1] & 0xf0) >> 2):1] < 0x14 or tcp[((tcp[12:1] & 0xf0) >> 2):1] > 0x17)"
	filter := fmt.Sprintf("(tcp and src net %s and src port (%s) and dst port (%s) and %s)", ServerIP, ServerSrcPort, ServerDstPort, tlsFilter)

	PCAP_GAMESERVER_FILTER = filter
}

var SERVER_START_AT = time.Now().Unix()

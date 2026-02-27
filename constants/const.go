package constants

import (
	"fmt"
	"time"
)

var PCAP_GAMESERVER_FILTER = ""

// kr server
// const _SERVER_MABI_KR = "211.218.233.0/24"
// const _PORT_MABI_KR = "11020 or 11021 or 11023"

// tw server - default values
var ServerMabiTwIP = "210.208.80.0/24"
var ServerMabiTwPort = "11022 or 59062"

// tw server - default values
var ServerIP = ""
var ServerPort = ""
var ClientIP = ""
var ClientPort = ""

// // Gearup Taiwan server (Taiwan 15) - default values
// var ServerGearupIP = "43.212.170.59"
// var ServerGearupSrcPort = "2081"
// var ServerGearupDstPort = "52819"

// Gearup Taiwan server (Taiwan 15) - default values
var ServerGearupIP = "127.0.0.1"
var ServerGearupSrcPort = "1111"
var ServerGearupDstPort = "52817"

// Flags to track if custom values are set
var UseCustomServerIP = false

func init() {
	RebuildFilter()
}

// RebuildFilter rebuilds the PCAP filter with current settings
func RebuildFilter() {
	// Filter for Mabi server or Gearup server
	// Also filter out TLS packets (content type 0x14-0x17) by checking first byte of TCP payload
	tlsFilter := "(tcp[((tcp[12:1] & 0xf0) >> 2):1] < 0x14 or tcp[((tcp[12:1] & 0xf0) >> 2):1] > 0x17)"

	// If custom server IP is specified, only use that filter
	if UseCustomServerIP {
		if ClientPort != "" {
			PCAP_GAMESERVER_FILTER = fmt.Sprintf("(tcp and src net %s and src port (%s) and dst port (%s) and %s)", ServerIP, ServerPort, ClientPort, tlsFilter)
		} else {
			PCAP_GAMESERVER_FILTER = fmt.Sprintf("(tcp and src net %s and src port (%s) and %s)", ServerIP, ServerPort, tlsFilter)
		}
		return
	}

	// Default: use both filters
	filterMabi := fmt.Sprintf("(tcp and src net %s and src port (%s) and %s)", ServerMabiTwIP, ServerMabiTwPort, tlsFilter)
	filterGearup := fmt.Sprintf("(tcp and src net %s and src port (%s) and dst port (%s) and %s)", ServerGearupIP, ServerGearupSrcPort, ServerGearupDstPort, tlsFilter)

	PCAP_GAMESERVER_FILTER = fmt.Sprintf("%s or %s", filterMabi, filterGearup)
}

var SERVER_START_AT = time.Now().Unix()

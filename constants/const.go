package constants

import (
	"fmt"
	"time"
)

var PCAP_GAMESERVER_FILTER = ""

// kr server
// const _SERVER_MABI_KR = "211.218.233.0/24"
// const _PORT_MABI_KR = "11020 or 11021 or 11023"

// tw server
const _SERVER_MABI_TW = "210.208.80.0/24"
const _PORT_MABI_TW = "11022 or 59062"

// Gearup Taiwan server (Taiwan 15)
const _SERVER_GEARUP = "43.212.170.59"
const _PORT_SRC_GEARUP = "2081"
const _PORT_DST_GEARUP = "59288"

func init() {
	// Filter for Mabi server or Gearup server
	// Also filter out TLS packets (content type 0x14-0x17) by checking first byte of TCP payload
	tlsFilter := "(tcp[((tcp[12:1] & 0xf0) >> 2):1] < 0x14 or tcp[((tcp[12:1] & 0xf0) >> 2):1] > 0x17)"
	filterMabi := fmt.Sprintf("(tcp and src net %s and src port (%s) and %s)", _SERVER_MABI_TW, _PORT_MABI_TW, tlsFilter)
	filterGearup := fmt.Sprintf("(tcp and src net %s and src port (%s) and dst port (%s) and %s)", _SERVER_GEARUP, _PORT_SRC_GEARUP, _PORT_DST_GEARUP, tlsFilter)

	PCAP_GAMESERVER_FILTER = fmt.Sprintf("%s or %s", filterMabi, filterGearup)
}

var SERVER_START_AT = time.Now().Unix()

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
const _PORT_GEARUP = "2082"

func init() {
	// Filter for Mabi server or Gearup server
	filterMabi := fmt.Sprintf("(tcp and src net %s and src port (%s))", _SERVER_MABI_TW, _PORT_MABI_TW)
	filterGearup := fmt.Sprintf("(tcp and src net %s and src port (%s))", _SERVER_GEARUP, _PORT_GEARUP)

	PCAP_GAMESERVER_FILTER = fmt.Sprintf("%s or %s", filterMabi, filterGearup)
}

var SERVER_START_AT = time.Now().Unix()

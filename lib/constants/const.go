package constants

import (
	"fmt"
	"strings"
	"time"
)

// Version is the build version. Override at link time via:
//
//	go build -ldflags "-X github.com/irusan-fanclub/mabidilmeter/lib/constants.Version=x.y.z"
var Version = "0.2.3"

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
//
// The filter is deliberately WIDE — the whole /24 server net plus the game
// port range — instead of pinning one (ip, src port, dst port) triple:
// on a channel switch the client connects to a DIFFERENT channel server
// (new ip / dst port); with a pinned filter those packets never reach the
// pcap handle, and by the time the watchdog installs a new reader the
// 0x5209 snapshot (sent in the first seconds) is already lost.
// readPacketLoop's dst-port switch handling then follows the new stream
// seamlessly. The explicit src port is kept as a fallback for servers
// outside the usual port range.
func RebuildFilter() {
	filter := fmt.Sprintf("tcp and src net %s and (src portrange 11000-11999 or src port (%s))",
		serverNet24(ServerIP), ServerSrcPort)
	PCAP_GAMESERVER_FILTER = filter
}

// serverNet24 turns "a.b.c.d" into the "a.b.c.0/24" network. Non-IPv4
// input is returned unchanged (keeps behaviour for empty/odd values).
func serverNet24(ip string) string {
	parts := strings.Split(ip, ".")
	if len(parts) != 4 {
		return ip
	}
	return fmt.Sprintf("%s.%s.%s.0/24", parts[0], parts[1], parts[2])
}

var SERVER_START_AT = time.Now().Unix()

package util

import (
	"fmt"
	"strings"
	"time"
)

// StartUnix is the process start time (unix seconds), shared as the common
// timestamp for this run's output filenames (mogugi_*.log,
// packet_capture_*.pcapng, packet_log_*.ndjson).
var StartUnix = time.Now().Unix()

// ServerNet24 turns "a.b.c.d" into the "a.b.c.0/24" network. Non-IPv4
// input is returned unchanged (keeps behaviour for empty/odd values).
func ServerNet24(ip string) string {
	parts := strings.Split(ip, ".")
	if len(parts) != 4 {
		return ip
	}
	return fmt.Sprintf("%s.%s.%s.0/24", parts[0], parts[1], parts[2])
}

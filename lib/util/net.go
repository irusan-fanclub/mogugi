package util

import "time"

// StartUnix is the process start time (unix seconds), shared as the common
// timestamp for this run's output filenames (dilmeter_*.log,
// packet_capture_*.pcapng, packet_log_*.ndjson).
var StartUnix = time.Now().Unix()

package util

import "time"

// fileStampLayout is local time, filename-safe, and lexically sortable —
// the same shape the packet-analysis tooling already uses.
const fileStampLayout = "2006-01-02_15-04-05"

func FileStamp(t time.Time) string { return t.Format(fileStampLayout) }

// StartStamp is the process start time, shared so the log and the pcapng
// of one run pair up by name. Derived from the same instant as StartUnix.
var StartStamp = FileStamp(time.Unix(StartUnix, 0))

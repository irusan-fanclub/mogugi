package util

import "time"

// fileStampLayout is local time, filename-safe, and lexically sortable —
// the same yyyymmdd_hhmmss shape the battle records use.
const fileStampLayout = "20060102_150405"

func FileStamp(t time.Time) string { return t.Format(fileStampLayout) }

// StartStamp is the process start time, shared so the log and the pcapng
// of one run pair up by name. Derived from the same instant as StartUnix.
var StartStamp = FileStamp(time.Unix(StartUnix, 0))

package util

import (
	"time"
)

// Seconds between 0001-01-01, the .NET epoch Mabi counts from, and 1970-01-01.
const unixEpochInDotnetSec = 62135596800

// MabiZone is the service timezone Mabi timestamps are written in; they carry local
// wall-clock, not UTC. Reassign it for another region.
var MabiZone = time.FixedZone("TW", 8*60*60)

// ParseMabiTime resolves a raw Mabi timestamp against MabiZone. Formatting the result
// reproduces the client's digits; Unix reports the real instant.
func ParseMabiTime(t uint64) time.Time {
	w := time.Unix(int64(t/1000)-unixEpochInDotnetSec, 0).UTC()

	return time.Date(w.Year(), w.Month(), w.Day(), w.Hour(), w.Minute(), w.Second(), 0, MabiZone)
}

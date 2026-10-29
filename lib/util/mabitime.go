package util

import (
	"math"
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

// NoExpiryMs is what MabiTimeUnixMilli returns for a raw value too large to represent:
// the game's "never expires" end time.
const NoExpiryMs = math.MaxInt64

// MabiTimeUnixMilli is ParseMabiTime to Unix milliseconds, keeping the sub-second part.
// Raw 0 means no expiry and stays 0.
func MabiTimeUnixMilli(t uint64) int64 {
	if t == 0 {
		return 0
	}
	if t/1000 > unixEpochInDotnetSec+math.MaxInt64/1000-86400 {
		return NoExpiryMs
	}
	return ParseMabiTime(t).Unix()*1000 + int64(t%1000)
}

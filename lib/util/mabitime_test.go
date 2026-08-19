package util

import (
	"testing"
	"time"
)

// Captured from a TW rev-164 CharacterCondition enable (0x0000A028) on 2026-08-14 that
// arrived at 10:23:52.144 UTC. MCAGT is when the buff took effect, SBT its expiry.
const (
	rawMCAGT = 63922328633042
	rawSBT   = 63922329023042
)

var packetArrival = time.Date(2026, 8, 14, 10, 23, 52, 144000000, time.UTC)

func TestParseMabiTimeKeepsWallClockDigits(t *testing.T) {
	got := ParseMabiTime(rawSBT).Format("2006-01-02 15:04:05")
	if want := "2026-08-14 18:30:23"; got != want {
		t.Fatalf("Format() = %q, want %q", got, want)
	}
}

func TestParseMabiTimeUnixIsTheRealInstant(t *testing.T) {
	want := time.Date(2026, 8, 14, 10, 23, 53, 0, time.UTC).Unix()
	if got := ParseMabiTime(rawMCAGT).Unix(); got != want {
		t.Fatalf("Unix() = %d, want %d (off by %d s)", got, want, got-want)
	}
}

// A buff cannot start before the packet that created it.
func TestParseMabiTimeStartFollowsItsPacket(t *testing.T) {
	delta := ParseMabiTime(rawMCAGT).Sub(packetArrival)
	if delta < 0 || delta > 2*time.Second {
		t.Fatalf("buff start is %v from its own packet; want within [0s, 2s]", delta)
	}
}

// Durations cancel the offset out, which is why a wrong zone stays invisible in them.
func TestParseMabiTimeDurationIsOffsetIndependent(t *testing.T) {
	if got := ParseMabiTime(rawSBT).Sub(ParseMabiTime(rawMCAGT)); got != 390*time.Second {
		t.Fatalf("duration = %v, want 390s", got)
	}
}

func TestParseMabiTimeHonoursMabiZone(t *testing.T) {
	orig := MabiZone
	t.Cleanup(func() { MabiZone = orig })

	tw := ParseMabiTime(rawSBT).Unix()

	MabiZone = time.FixedZone("KST", 9*60*60)
	kst := ParseMabiTime(rawSBT)

	if digits := kst.Format("15:04:05"); digits != "18:30:23" {
		t.Errorf("digits = %q, want them unchanged by the zone", digits)
	}
	if delta := kst.Unix() - tw; delta != -3600 {
		t.Errorf("instant moved %d s for a +1 h zone, want -3600", delta)
	}
}

package app

import (
	"math"
	"testing"

	"github.com/irusan-fanclub/mogugi/lib/util"
)

func TestServerClockObserve(t *testing.T) {
	type obs struct{ capture, start int64 }
	steps := []struct {
		name string
		obs  []obs
		want int64
	}{
		{"first sample calibrates", []obs{{1000, 5560}}, 4560},
		{"small drift follows", []obs{{1000, 5560}, {61000, 65575}}, 4575},
		{"stale resend does not move offset", []obs{{1000, 5560}, {61000, 65575}, {70000, 30000}, {70000, 30000}}, 4575},
		{"jump needs two casts", []obs{{1000, 5560}, {61000, 65575}, {80000, 90200}}, 4575},
		{"jump confirmed by second cast", []obs{{1000, 5560}, {61000, 65575}, {80000, 90200}, {90000, 100195}}, 10195},
		{"downward jump", []obs{{1000, 13200}, {80000, 91350}, {90000, 101300}}, 11300},
		{"stale buff group is one cast", []obs{{1000, 5560}, {61000, 65575}, {70000, 58000}, {70000, 58001}, {70000, 58002}}, 4575},
		{"casts 1s+ apart both vote", []obs{{1000, 5560}, {80000, 90200}, {90000, 100250}}, 10250},
		{"same cast twice is one vote", []obs{{1000, 5560}, {80000, 90200}, {80100, 90200}}, 4560},
		{"old candidate expires", []obs{{1000, 5560}, {80000, 90200}, {80000 + 11*60_000, 90195 + 11*60_000}}, 4560},
	}
	for _, s := range steps {
		t.Run(s.name, func(t *testing.T) {
			var c serverClock
			for _, o := range s.obs {
				c.observe(o.capture, o.start)
			}
			got, ok := c.offsetMs()
			if !ok || got != s.want {
				t.Fatalf("offset = %d ok=%v, want %d", got, ok, s.want)
			}
		})
	}
}

func TestServerClockObserveReportsChange(t *testing.T) {
	var c serverClock
	if !c.observe(1000, 5560) {
		t.Error("first sample must report")
	}
	if c.observe(61000, 65575) {
		t.Error("15ms drift must not report")
	}
	c.observe(80000, 90200)
	if !c.observe(90000, 100195) {
		t.Error("confirmed jump must report")
	}
}

func TestServerClockUncalibrated(t *testing.T) {
	var c serverClock
	if _, ok := c.offsetMs(); ok {
		t.Fatal("ok before any sample")
	}
	if got := c.toLocalSec(1792415729615); got != 1792415729.615 {
		t.Fatalf("toLocalSec = %v, want unshifted", got)
	}
}

func TestServerClockToLocalSec(t *testing.T) {
	var c serverClock
	c.observe(1000, 5560)
	if got := c.toLocalSec(1792415729615); math.Abs(got-1792415725.055) > 1e-6 {
		t.Fatalf("toLocalSec = %v, want 1792415725.055", got)
	}
	if got := c.toLocalSec(0); got != 0 {
		t.Fatalf("toLocalSec(0) = %v, want 0", got)
	}
}

func TestSampleFromParams(t *testing.T) {
	good := map[string]string{"MCAGT": "63928041329615", "SDUR": "300000", "SBT": "63928041629615"}
	if got, song, ok := sampleFromParams(511, good); !ok || song || got != util.MabiTimeUnixMilli(63928041329615) {
		t.Fatalf("got %d song=%v ok=%v", got, song, ok)
	}
	bad := []map[string]string{
		{"MCAGT": "63928041329615", "SDUR": "299999", "SBT": "63928041629615"},
		{"MCAGT": "63928041329615", "SDUR": "300000"},
		{"SDUR": "300000", "SBT": "63928041629615"},
		{"MCAGT": "x", "SDUR": "300000", "SBT": "63928041629615"},
		nil,
	}
	for i, p := range bad {
		if _, _, ok := sampleFromParams(511, p); ok {
			t.Errorf("case %d accepted", i)
		}
	}
}

func TestServerClockNoExpirySentinel(t *testing.T) {
	var c serverClock
	before := c.toLocalSec(util.NoExpiryMs)
	if before < 1e12 {
		t.Fatalf("sentinel = %v, want huge positive", before)
	}
	c.observe(1000, 5560)
	c.observe(80000, 190200)
	c.observe(90000, 200200)
	if got := c.toLocalSec(util.NoExpiryMs); got != before {
		t.Fatalf("sentinel moved with offset: %v vs %v", got, before)
	}
}

func TestSampleFromParamsSong(t *testing.T) {
	song := map[string]string{"MCAGT": "63928041329615", "SBT": "63928041629615"}
	for _, id := range []uint32{192, 193, 194, 680, 681} {
		got, isSong, ok := sampleFromParams(id, song)
		if !ok || !isSong || got != util.MabiTimeUnixMilli(63928041329615) {
			t.Errorf("cc %d: got %d song=%v ok=%v", id, got, isSong, ok)
		}
	}
	if _, _, ok := sampleFromParams(511, song); ok {
		t.Error("non-song without SDUR accepted")
	}
	bad := []map[string]string{
		{"MCAGT": "63928041329615", "SBT": "63928041329615"},
		{"MCAGT": "63928041629615", "SBT": "63928041329615"},
		{"MCAGT": "63928041329615"},
		{"SBT": "63928041629615"},
	}
	for i, p := range bad {
		if _, _, ok := sampleFromParams(680, p); ok {
			t.Errorf("song case %d accepted", i)
		}
	}
}

func TestServerClockObserveSong(t *testing.T) {
	var c serverClock
	if c.observeSong(1000, 5560) {
		t.Error("one song sample must not calibrate")
	}
	if _, ok := c.offsetMs(); ok {
		t.Fatal("calibrated by a single song sample")
	}
	if c.observeSong(1500, 6060) {
		t.Error("same cast twice must not calibrate")
	}
	if _, ok := c.offsetMs(); ok {
		t.Fatal("calibrated by one cast")
	}
	if c.observeSong(50000, 54700) {
		t.Error("disagreeing songs must not calibrate")
	}
	if _, ok := c.offsetMs(); ok {
		t.Fatal("calibrated by disagreeing songs")
	}
	if !c.observeSong(90000, 94590) {
		t.Error("two agreeing casts must calibrate and report")
	}
	if got, ok := c.offsetMs(); !ok || got != 4590 {
		t.Fatalf("offset = %d ok=%v, want 4590", got, ok)
	}
}

func TestServerClockSongSamplesExpire(t *testing.T) {
	var c serverClock
	c.observeSong(1000, 5560)
	c.observeSong(1000+11*60_000, 5560+11*60_000+4000)
	if _, ok := c.offsetMs(); ok {
		t.Fatal("expired song sample still counted")
	}
}

func TestServerClockTrustedSampleCalibratesAlone(t *testing.T) {
	var c serverClock
	c.observeSong(1000, 5560)
	if !c.observe(2000, 7000) {
		t.Error("trusted sample must report")
	}
	if got, ok := c.offsetMs(); !ok || got != 5000 {
		t.Fatalf("offset = %d ok=%v, want 5000", got, ok)
	}
}

func TestServerClockSongAfterCalibrationFollows(t *testing.T) {
	var c serverClock
	c.observe(1000, 5560)
	c.observeSong(61000, 65575)
	if got, _ := c.offsetMs(); got != 4575 {
		t.Fatalf("offset = %d, want 4575", got)
	}
	c.observeSong(70000, 30000)
	if got, _ := c.offsetMs(); got != 4575 {
		t.Fatalf("stale song moved offset to %d", got)
	}
}

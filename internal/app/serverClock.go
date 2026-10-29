package app

import (
	"strconv"

	"github.com/irusan-fanclub/mogugi/lib/util"
)

const (
	clockFollowMs    = 500         // a sample this close to the estimate is drift
	clockAgreeMs     = 100         // two casts agreeing this closely confirm a jump
	clockSameCastMs  = 1000        // starts closer than this are one cast (a buff group lands within ms)
	clockReportMs    = 50          // estimate moves smaller than this are not reported
	clockCandidateMs = 10 * 60_000 // candidates older than this are dropped
)

type clockCandidate struct {
	captureMs, startMs, sampleMs int64
}

// serverClock tracks the game server's clock minus the local one from the start
// time of freshly cast conditions. Not safe for concurrent use.
type serverClock struct {
	estimate   int64
	calibrated bool
	candidates []clockCandidate
}

func abs64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

// observe feeds one fresh-cast sample; captureMs is the packet capture time (Unix ms),
// startMs the server cast start (MCAGT, Unix ms). Returns true when the estimate changed by > 50ms.
func (c *serverClock) observe(captureMs, startMs int64) bool {
	sample := startMs - captureMs

	kept := c.candidates[:0]
	for _, k := range c.candidates {
		if captureMs-k.captureMs <= clockCandidateMs {
			kept = append(kept, k)
		}
	}
	c.candidates = kept

	if !c.calibrated {
		c.estimate, c.calibrated = sample, true
		c.candidates = c.candidates[:0]
		return true
	}
	if abs64(sample-c.estimate) <= clockFollowMs {
		return c.set(sample)
	}

	// Far from the estimate: a resend of an old buff, or a real jump. Only two
	// different casts agreeing with each other confirm the jump.
	for _, k := range c.candidates {
		if abs64(k.startMs-startMs) < clockSameCastMs {
			return false
		}
	}
	for _, k := range c.candidates {
		if abs64(k.sampleMs-sample) <= clockAgreeMs {
			c.candidates = c.candidates[:0]
			return c.set(sample)
		}
	}
	c.candidates = append(c.candidates, clockCandidate{captureMs, startMs, sample})
	return false
}

// observeSong feeds a bard song's cast start. Songs are less trustworthy than
// conditions with SDUR, so until calibrated two songs from different casts must
// agree; afterwards a song is an ordinary sample.
func (c *serverClock) observeSong(captureMs, startMs int64) bool {
	if c.calibrated {
		return c.observe(captureMs, startMs)
	}
	sample := startMs - captureMs
	kept := c.candidates[:0]
	for _, k := range c.candidates {
		if captureMs-k.captureMs <= clockCandidateMs {
			kept = append(kept, k)
		}
	}
	c.candidates = kept
	for _, k := range c.candidates {
		if abs64(k.startMs-startMs) >= clockSameCastMs && abs64(k.sampleMs-sample) <= clockAgreeMs {
			c.estimate, c.calibrated = sample, true
			c.candidates = c.candidates[:0]
			return true
		}
	}
	c.candidates = append(c.candidates, clockCandidate{captureMs, startMs, sample})
	return false
}

func (c *serverClock) set(v int64) bool {
	changed := abs64(v-c.estimate) > clockReportMs
	c.estimate = v
	return changed
}

// offsetMs is server − local; ok is false until calibrated.
func (c *serverClock) offsetMs() (int64, bool) {
	return c.estimate, c.calibrated
}

// toLocalSec converts a server Unix ms expiry to local Unix seconds; 0 means no expiry.
func (c *serverClock) toLocalSec(serverMs int64) float64 {
	if serverMs == 0 {
		return 0
	}
	if serverMs == util.NoExpiryMs {
		return float64(util.NoExpiryMs) / 1000 // far-future sentinel, never offset-shifted
	}
	return float64(serverMs-c.estimate) / 1000
}

var clockSongCCIds = map[uint32]bool{192: true, 193: true, 194: true, 680: true, 681: true}

// sampleFromParams extracts the cast start (Unix ms). A condition qualifies when MCAGT,
// SDUR and SBT are all present and SBT−MCAGT == SDUR; a bard song (song is true) has no
// SDUR and qualifies when SBT > MCAGT.
func sampleFromParams(ccId uint32, params map[string]string) (startMs int64, song, ok bool) {
	song = clockSongCCIds[ccId]
	keys := []string{"MCAGT", "SDUR", "SBT"}
	if song {
		keys = []string{"MCAGT", "SBT"}
	}
	v := make([]uint64, len(keys))
	for i, k := range keys {
		n, err := strconv.ParseUint(params[k], 10, 64)
		if err != nil {
			return 0, false, false
		}
		v[i] = n
	}
	start, sbt := v[0], v[len(v)-1]
	if song {
		if sbt <= start {
			return 0, false, false
		}
	} else if sbt < start || sbt-start != v[1] {
		return 0, false, false
	}
	return util.MabiTimeUnixMilli(start), song, true
}

package app

import "sort"

const (
	minInvincibleSec = 2
	openingSec       = 5
)

// bossInvincibleCCId is the synthetic condition for the 0x7533 boss-invincible flag.
const bossInvincibleCCId uint32 = 91000

// invincibleCCs are the boss-invincible conditions; their spans are unioned
// even where the boss still takes damage (277 can).
var invincibleCCs = map[uint32]bool{494: true, 277: true, bossInvincibleCCId: true}

// span is a half-open [a, b) range in unix seconds.
type span [2]int64

type ccToggle struct {
	At   int64
	CCId uint32
	On   bool
}

type hitRec struct {
	At     int64
	Who    string
	Damage float64
}

func mergeSpans(in []span) []span {
	s := append([]span(nil), in...)
	sort.Slice(s, func(i, j int) bool {
		if s[i][0] != s[j][0] {
			return s[i][0] < s[j][0]
		}
		return s[i][1] < s[j][1]
	})
	var out []span
	for _, x := range s {
		if n := len(out); n > 0 && x[0] <= out[n-1][1] {
			if x[1] > out[n-1][1] {
				out[n-1][1] = x[1]
			}
		} else {
			out = append(out, x)
		}
	}
	return out
}

// invincibleWindows pairs toggles per CC, unions all CCs and drops merged
// spans shorter than minInvincibleSec. Open spans close at endSec.
func invincibleWindows(toggles []ccToggle, endSec int64) []span {
	ordered := append([]ccToggle(nil), toggles...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].At < ordered[j].At })
	open := map[uint32]int64{}
	var spans []span
	for _, t := range ordered {
		if t.On {
			if _, ok := open[t.CCId]; !ok {
				open[t.CCId] = t.At
			}
		} else if a, ok := open[t.CCId]; ok {
			spans = append(spans, span{a, t.At})
			delete(open, t.CCId)
		}
	}
	for _, a := range open {
		spans = append(spans, span{a, endSec})
	}
	var out []span
	for _, s := range mergeSpans(spans) {
		if s[1]-s[0] >= minInvincibleSec {
			out = append(out, s)
		}
	}
	return out
}

// deathToggle is one player death (Dead) or revive (!Dead).
type deathToggle struct {
	At   int64
	Dead bool
}

// deathSpans pairs each death with the next revive; a death still open
// closes at endSec.
func deathSpans(toggles []deathToggle, endSec int64) []span {
	ordered := append([]deathToggle(nil), toggles...)
	sort.SliceStable(ordered, func(i, j int) bool { return ordered[i].At < ordered[j].At })
	var out []span
	open, from := false, int64(0)
	for _, t := range ordered {
		if t.Dead && !open {
			open, from = true, t.At
		} else if !t.Dead && open {
			out = append(out, span{from, t.At})
			open = false
		}
	}
	if open {
		out = append(out, span{from, endSec})
	}
	return out
}

func excludedSpans(fightStart int64, inv []span) []span {
	return mergeSpans(append([]span{{fightStart, fightStart + openingSec}}, inv...))
}

// activeDps is damage outside excluded spans over window time outside them;
// ok is false when no time remains.
func activeDps(hits []hitRec, windows, excluded []span) (float64, bool) {
	var t int64
	for _, w := range windows {
		t += w[1] - w[0]
		for _, x := range excluded {
			lo, hi := max(w[0], x[0]), min(w[1], x[1])
			if hi > lo {
				t -= hi - lo
			}
		}
	}
	if t <= 0 {
		return 0, false
	}
	var dmg float64
	for _, h := range hits {
		in := false
		for _, x := range excluded {
			if h.At >= x[0] && h.At < x[1] {
				in = true
				break
			}
		}
		if !in {
			dmg += h.Damage
		}
	}
	return dmg / float64(t), true
}

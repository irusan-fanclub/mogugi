package app

import "time"

const clientRetryInterval = 10 * time.Second

// clientRetryGate throttles version detection for one PID after a failure:
// log only the first failure, retry at most once per interval.
type clientRetryGate struct {
	pid      uint32
	failedAt time.Time
	failed   bool
}

// allow reports whether detection may run for pid now.
func (g *clientRetryGate) allow(pid uint32, now time.Time) bool {
	if !g.failed || g.pid != pid {
		return true
	}
	return now.Sub(g.failedAt) >= clientRetryInterval
}

// fail records a failed attempt and reports whether it is the first for pid (log it).
func (g *clientRetryGate) fail(pid uint32, now time.Time) (first bool) {
	first = !g.failed || g.pid != pid
	g.pid, g.failed, g.failedAt = pid, true, now
	return first
}

// ok clears the failure state after a successful detection.
func (g *clientRetryGate) ok() { g.failed = false }

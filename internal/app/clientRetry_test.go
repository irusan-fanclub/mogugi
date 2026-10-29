package app

import (
	"testing"
	"time"
)

func TestClientRetryGate(t *testing.T) {
	var g clientRetryGate
	t0 := time.Unix(1000, 0)
	if !g.allow(5, t0) {
		t.Fatal("first attempt must be allowed")
	}
	if !g.fail(5, t0) {
		t.Fatal("first failure for a pid must be logged")
	}
	if g.allow(5, t0.Add(500*time.Millisecond)) || g.allow(5, t0.Add(9*time.Second)) {
		t.Fatal("same pid must back off")
	}
	if !g.allow(5, t0.Add(10*time.Second)) {
		t.Fatal("retry after the interval")
	}
	if g.fail(5, t0.Add(10*time.Second)) {
		t.Fatal("repeat failure for the same pid must not log")
	}
	if !g.allow(6, t0.Add(11*time.Second)) {
		t.Fatal("a new pid is not throttled")
	}
	if !g.fail(6, t0.Add(11*time.Second)) {
		t.Fatal("first failure of a new pid is logged")
	}
	g.ok()
	if !g.allow(6, t0.Add(12*time.Second)) {
		t.Fatal("success clears the throttle")
	}
}

package main

import (
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/packet"
)

const (
	testOwnerId  = uint64(4503599630022047)
	testSummonId = uint64(4767482418118415)
)

func newTestPublisher() *eventPublisher {
	return &eventPublisher{
		entityCache:  make(entityCache),
		summonOwners: make(map[uint64]summonLink),
	}
}

func addTestEntity(t *eventPublisher, id uint64, raceId uint32, at time.Time) {
	t.entityCache.add(&packet.EntityInfo{Id: id, Name: "puppet", RaceId: raceId}, at)
}

// A marionette's appear packet carries no owner; the link comes from 0x9025.
func TestLinkSummonBeforeAppear(t *testing.T) {
	pub := newTestPublisher()
	now := time.Now()

	if e := pub.linkSummon(testSummonId, testOwnerId, now.Unix()); e != nil {
		t.Fatalf("unknown entity should not produce an appear event, got %+v", e)
	}

	addTestEntity(pub, testSummonId, 990216, now)

	pub.Lock()
	got := pub.summonerIdOf(testSummonId)
	pub.Unlock()

	if want := "4503599630022047"; got != want {
		t.Errorf("summonerIdOf = %q, want %q", got, want)
	}
}

// The link can also arrive after the entity is already known; the entity then
// needs a refreshed appear event or the frontend never learns about it.
func TestLinkSummonAfterAppear(t *testing.T) {
	pub := newTestPublisher()
	now := time.Now()

	addTestEntity(pub, testSummonId, 990216, now)

	e := pub.linkSummon(testSummonId, testOwnerId, now.Unix())
	if e == nil {
		t.Fatal("known entity should produce a refreshed appear event")
	}
	if want := "4503599630022047"; e.SummonerId != want {
		t.Errorf("SummonerId = %q, want %q", e.SummonerId, want)
	}
	if e.OwnerId != "" {
		t.Errorf("OwnerId = %q, want empty (a marionette has no pet owner)", e.OwnerId)
	}
}

func TestLinkSummonIgnoresZeroIds(t *testing.T) {
	pub := newTestPublisher()
	now := time.Now().Unix()

	for _, c := range []struct{ summonId, ownerId uint64 }{{0, testOwnerId}, {testSummonId, 0}} {
		if e := pub.linkSummon(c.summonId, c.ownerId, now); e != nil {
			t.Errorf("linkSummon(%d, %d) = %+v, want nil", c.summonId, c.ownerId, e)
		}
		if len(pub.summonOwners) != 0 {
			t.Errorf("linkSummon(%d, %d) stored a link", c.summonId, c.ownerId)
		}
	}
}

// Marionettes and other summons send a 0x5209 snapshot like any owned entity,
// but they carry no real inventory and would flood items_log with one file per
// summon (named after the raw entity id).
func TestIsSummonRace(t *testing.T) {
	summons := []uint32{
		990104, // 小丑人偶
		990125, // 墮落者的小丑人偶
		990204, // 巨像人偶
		990216, // 巨人型 (tw-159)
		990028, // 地獄犬
	}
	keep := []uint32{
		10001, 10002, // player characters
		490359, // 紅炎的精靈龍 (pet)
		490290, // cart pet
		440516, // partner
		0,      // unknown (head not parseable) — must not be filtered
	}

	for _, r := range summons {
		if !isSummonRace(r) {
			t.Errorf("isSummonRace(%d) = false, want true", r)
		}
	}
	for _, r := range keep {
		if isSummonRace(r) {
			t.Errorf("isSummonRace(%d) = true, want false", r)
		}
	}
}

// Links for entities that never appeared must not accumulate forever, but must
// survive long enough to meet an appear packet that arrives right after.
func TestPruneSummonOwners(t *testing.T) {
	pub := newTestPublisher()
	now := time.Now()

	stale := uint64(1)
	fresh := uint64(2)
	live := testSummonId

	addTestEntity(pub, live, 990216, now)

	pub.Lock()
	pub.summonOwners[stale] = summonLink{ownerId: testOwnerId, at: now.Unix() - 3600}
	pub.summonOwners[fresh] = summonLink{ownerId: testOwnerId, at: now.Unix() - 10}
	pub.summonOwners[live] = summonLink{ownerId: testOwnerId, at: now.Unix() - 3600}
	pub.pruneSummonOwners(now.Unix())
	_, hasStale := pub.summonOwners[stale]
	_, hasFresh := pub.summonOwners[fresh]
	_, hasLive := pub.summonOwners[live]
	pub.Unlock()

	if hasStale {
		t.Error("stale link for an entity that never appeared was kept")
	}
	if !hasFresh {
		t.Error("recent link was pruned before its appear packet could arrive")
	}
	if !hasLive {
		t.Error("link for a live entity was pruned")
	}
}

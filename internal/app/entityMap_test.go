package app

import (
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/packet"
)

func TestEntityCacheCleanupReportsRemoved(t *testing.T) {
	c := make(entityCache)
	t0 := time.Unix(1_000_000, 0)
	c.add(&packet.EntityInfo{Id: 5, Name: "mob", RaceId: 4856}, t0)
	c.disappear(5, t0)

	removed := c.add(&packet.EntityInfo{Id: 6, Name: "other", RaceId: 4856}, t0.Add(61*time.Second))
	if len(removed) != 1 || removed[0] != 5 {
		t.Fatalf("removed = %v, want [5]", removed)
	}
	if _, ok := c[5]; ok {
		t.Fatal("entity 5 still cached")
	}
}

func TestForgetEntitiesKeepsOwner(t *testing.T) {
	p := &eventPublisher{
		ownerId:        7,
		bossEntities:   map[uint64]string{7: "a", 9: "b"},
		maxLifeSeen:    map[uint64]float64{7: 1, 9: 1},
		lifeSeen:       map[uint64]lifeState{7: {}, 9: {}},
		downedEntities: map[uint64]bool{7: true, 9: true},
		deadPlayers:    map[uint64]int64{7: 1, 9: 1},
		statTables:     map[uint64]packet.StatTable{7: {}, 9: {}},
	}
	p.forgetEntitiesLocked([]uint64{7, 9})

	if _, ok := p.bossEntities[9]; ok {
		t.Error("bossEntities kept 9")
	}
	if _, ok := p.maxLifeSeen[9]; ok {
		t.Error("maxLifeSeen kept 9")
	}
	if _, ok := p.lifeSeen[9]; ok {
		t.Error("lifeSeen kept 9")
	}
	if _, ok := p.downedEntities[9]; ok {
		t.Error("downedEntities kept 9")
	}
	if _, ok := p.deadPlayers[9]; ok {
		t.Error("deadPlayers kept 9")
	}
	if _, ok := p.statTables[9]; ok {
		t.Error("statTables kept 9")
	}
	if len(p.bossEntities) != 1 || len(p.maxLifeSeen) != 1 || len(p.lifeSeen) != 1 ||
		len(p.downedEntities) != 1 || len(p.deadPlayers) != 1 || len(p.statTables) != 1 {
		t.Error("owner 7 was dropped from some map")
	}
}

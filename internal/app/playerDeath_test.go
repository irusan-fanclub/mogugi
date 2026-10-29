package app

import (
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

func publishedDeaths(p *eventPublisher) []event.EventEntityDeath {
	p.Lock()
	defer p.Unlock()
	var got []event.EventEntityDeath
	for _, ev := range p.pendingEvents {
		if e, ok := ev.(*event.EventEntityDeath); ok {
			got = append(got, *e)
		}
	}
	return got
}

func deathPacket(op packet.OpCode, id uint64, at time.Time) *packet.GamePacket {
	return &packet.GamePacket{Op: op, Id: id, At: at}
}

// 0x53FC kills a player once; 0x53FD revives it; repeats are dropped.
func TestPlayerDeathAndRevive(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.entityCache[7] = &entityInfoExtend{EntityInfo: &packet.EntityInfo{Id: 7, Name: "me", RaceId: 10002}}
	at := time.Unix(1_700_000_000, 0)

	p.handlePacket(deathPacket(packet.OpcodeIsNowDead, 7, at))
	p.handlePacket(deathPacket(packet.OpcodeIsNowDead, 7, at.Add(time.Second)))
	p.handlePacket(deathPacket(packet.OpcodeRemoveDeathScreen, 7, at.Add(14*time.Second)))
	p.handlePacket(deathPacket(packet.OpcodeRemoveDeathScreen, 7, at.Add(15*time.Second)))

	got := publishedDeaths(p)
	if len(got) != 2 || !got[0].Dead || got[0].At != at.Unix() || got[0].Id != "7" ||
		got[1].Dead || got[1].At != at.Unix()+14 {
		t.Fatalf("deaths = %+v", got)
	}
}

// A teammate gets no 0x53FD; public life back above zero revives it.
func TestPlayerReviveByLife(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.entityCache[7] = &entityInfoExtend{EntityInfo: &packet.EntityInfo{Id: 7, Name: "mate", RaceId: 9001}}
	at := time.Unix(1_700_000_000, 0)

	pk := statUpdatePublicPacket(7, 500, 3643)
	pk.At = at
	p.handlePacket(pk) // alive: no revive event
	p.handlePacket(deathPacket(packet.OpcodeIsNowDead, 7, at.Add(time.Second)))
	pk = statUpdatePublicPacket(7, 0, 3643)
	pk.At = at.Add(2 * time.Second)
	p.handlePacket(pk) // still dead
	pk = statUpdatePublicPacket(7, 5989, 3643)
	pk.At = at.Add(20 * time.Second)
	p.handlePacket(pk)

	got := publishedDeaths(p)
	if len(got) != 2 || !got[0].Dead || got[1].Dead || got[1].At != at.Unix()+20 {
		t.Fatalf("deaths = %+v", got)
	}
}

// Monsters die all the time; only player races publish.
func TestMonsterDeathSilent(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.entityCache[8] = &entityInfoExtend{EntityInfo: &packet.EntityInfo{Id: 8, Name: "mob", RaceId: 4354}}
	p.handlePacket(deathPacket(packet.OpcodeIsNowDead, 8, time.Now()))
	p.handlePacket(deathPacket(packet.OpcodeIsNowDead, 99, time.Now())) // unknown entity
	if got := publishedDeaths(p); len(got) != 0 {
		t.Fatalf("deaths = %+v", got)
	}
}

// A client attaching while a player lies dead sees the death in its snapshot.
func TestSnapshotCarriesOpenDeath(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.entityCache[7] = &entityInfoExtend{EntityInfo: &packet.EntityInfo{Id: 7, Name: "me", RaceId: 10002}}
	at := time.Unix(1_700_000_000, 0)
	p.handlePacket(deathPacket(packet.OpcodeIsNowDead, 7, at))
	for _, ev := range p.snapshotEvents(true) {
		if e, ok := ev.(*event.EventEntityDeath); ok && e.Id == "7" && e.Dead && e.At == at.Unix() {
			return
		}
	}
	t.Fatal("snapshot lacks the open death")
}

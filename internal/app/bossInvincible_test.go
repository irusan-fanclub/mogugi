package app

import (
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

const regionId = 3458764513820540928

func invinciblePacket(id uint64, on uint8, at time.Time) *packet.GamePacket {
	return &packet.GamePacket{
		Op: packet.OpcodeEntityInvincible, Id: regionId, At: at,
		Msg: packet.Message{packet.NewMessageElemLong(id), packet.NewMessageElemByte(on)},
	}
}

// invincibleToggle is one published CC 91000 change.
type invincibleToggle struct {
	Id string
	At int64
	On bool
}

func invincibleOf(events []event.IEvent) []invincibleToggle {
	var got []invincibleToggle
	for _, ev := range events {
		switch e := ev.(type) {
		case *event.EventCharacterConditionEnable:
			if e.CCId == bossInvincibleCCId {
				got = append(got, invincibleToggle{e.Id, e.At, true})
			}
		case *event.EventCharacterConditionDisable:
			if e.CCId == bossInvincibleCCId {
				got = append(got, invincibleToggle{e.Id, e.At, false})
			}
		}
	}
	return got
}

func publishedInvincible(p *eventPublisher) []invincibleToggle {
	p.Lock()
	defer p.Unlock()
	return invincibleOf(p.pendingEvents)
}

// The region's 0x7533 toggles CC 91000 on a boss; repeats of the current state are dropped.
func TestBossInvincibleToggles(t *testing.T) {
	p := newEventPublisherForTest(t)
	at := time.Unix(1_793_193_606, 0)

	p.handlePacket(invinciblePacket(42, 0, at)) // already hittable: silent
	p.handlePacket(invinciblePacket(42, 1, at.Add(time.Second)))
	p.handlePacket(invinciblePacket(42, 1, at.Add(2*time.Second)))
	p.handlePacket(invinciblePacket(42, 0, at.Add(47*time.Second)))

	got := publishedInvincible(p)
	want := []invincibleToggle{{"42", at.Unix() + 1, true}, {"42", at.Unix() + 47, false}}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("invincible = %+v", got)
	}
}

func TestBossInvincibleIgnoresMalformed(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.handlePacket(&packet.GamePacket{Op: packet.OpcodeEntityInvincible, Id: regionId, At: time.Now(),
		Msg: packet.Message{packet.NewMessageElemByte(1)}})
	if got := publishedInvincible(p); len(got) != 0 {
		t.Fatalf("invincible = %+v", got)
	}
}

// A client attaching mid-mechanic sees CC 91000 on in its snapshot.
func TestSnapshotCarriesOpenInvincible(t *testing.T) {
	p := newEventPublisherForTest(t)
	p.entityCache[42] = &entityInfoExtend{EntityInfo: &packet.EntityInfo{Id: 42, RaceId: 7603}}
	at := time.Unix(1_793_193_606, 0)
	p.handlePacket(invinciblePacket(42, 1, at))

	got := invincibleOf(p.snapshotEvents(false))
	if len(got) != 1 || got[0] != (invincibleToggle{"42", at.Unix(), true}) {
		t.Fatalf("snapshot invincible = %+v", got)
	}

	p.Lock()
	p.forgetEntitiesLocked([]uint64{42})
	p.Unlock()
	if _, ok := p.invincible[42]; ok {
		t.Fatal("forgotten boss still invincible")
	}
}

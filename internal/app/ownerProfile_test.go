package app

import (
	"testing"
	"time"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

const giantOwnerId = uint64(4503599632926878)

func ownerProfileEvents(p *eventPublisher) []*event.EventOwnerProfile {
	var out []*event.EventOwnerProfile
	for _, e := range p.pendingEvents {
		if pe, ok := e.(*event.EventOwnerProfile); ok {
			out = append(out, pe)
		}
	}
	return out
}

func giantSnapshotPacket(t *testing.T) *packet.GamePacket {
	t.Helper()
	msg, err := packetFixtureMessage(t, "0x5209_profile_tw166_giant.json")
	if err != nil {
		t.Fatal(err)
	}
	return &packet.GamePacket{At: time.Now(), Op: packet.OpcodeChannelCharacterInfoR, Id: giantOwnerId, Msg: msg}
}

func equipTitlePacket(id uint64, first, second uint32) *packet.GamePacket {
	return &packet.GamePacket{
		At: time.Now(), Op: packet.OpcodeEquipTitleReply, Id: id,
		Msg: packet.Message{packet.NewMessageElemInt(first), packet.NewMessageElemInt(second)},
	}
}

func TestOwnerProfile_PublishedFromOwnSnapshotAndDeduped(t *testing.T) {
	withTestItemDB(t)
	p := newTestPublisher()
	p.handleChannelCharacterInfo(giantSnapshotPacket(t))

	evs := ownerProfileEvents(p)
	if len(evs) != 1 {
		t.Fatalf("got %d profile events, want 1", len(evs))
	}
	prof := evs[0].Profile
	if prof.Titles.TitleId != 10700 || prof.Titles.OptionTitleId != 9180 {
		t.Errorf("titles = %+v", prof.Titles)
	}
	if prof.Talent.GrandmasterTalentId != 10 || prof.MultiClass.CurrentClassId != 10 || len(prof.MultiClass.Classes) != 9 {
		t.Errorf("talent=%+v multiClass=%+v", prof.Talent, prof.MultiClass)
	}

	p.handleChannelCharacterInfo(giantSnapshotPacket(t))
	if n := len(ownerProfileEvents(p)); n != 1 {
		t.Errorf("identical snapshot republished: %d events", n)
	}
}

func TestOwnerProfile_EquipTitleReplyOverwritesTitlesOnly(t *testing.T) {
	withTestItemDB(t)
	p := newTestPublisher()
	p.handleChannelCharacterInfo(giantSnapshotPacket(t))

	p.handleEquipTitleReply(equipTitlePacket(giantOwnerId, 10700, 8038))

	evs := ownerProfileEvents(p)
	if len(evs) != 2 {
		t.Fatalf("got %d profile events, want 2", len(evs))
	}
	last := evs[1].Profile
	if last.Titles.TitleId != 10700 || last.Titles.OptionTitleId != 8038 {
		t.Errorf("titles = %+v, want 10700/8038", last.Titles)
	}
	if last.Talent == nil || last.Talent.GrandmasterTalentId != 10 || last.MultiClass == nil {
		t.Errorf("other sections must survive: %+v", last)
	}
	if evs[0].Profile.Titles.OptionTitleId != 9180 {
		t.Error("the earlier published event was mutated")
	}
}

func TestOwnerProfile_EquipTitleReplyIgnored(t *testing.T) {
	withTestItemDB(t)
	p := newTestPublisher()
	// No snapshot yet.
	p.handleEquipTitleReply(equipTitlePacket(giantOwnerId, 1, 2))
	if n := len(ownerProfileEvents(p)); n != 0 {
		t.Fatalf("title reply before a snapshot published %d events", n)
	}
	p.handleChannelCharacterInfo(giantSnapshotPacket(t))
	// Another entity's reply, and a short body.
	p.handleEquipTitleReply(equipTitlePacket(giantOwnerId+1, 1, 2))
	p.handleEquipTitleReply(&packet.GamePacket{Op: packet.OpcodeEquipTitleReply, Id: giantOwnerId, Msg: packet.Message{packet.NewMessageElemInt(1)}})
	if n := len(ownerProfileEvents(p)); n != 1 {
		t.Errorf("got %d profile events, want only the snapshot's", n)
	}
}

func TestOwnerProfile_InLeadEventsAndClearedOnOwnerChange(t *testing.T) {
	withTestItemDB(t)
	p := newTestPublisher()
	p.handleChannelCharacterInfo(giantSnapshotPacket(t))

	p.Lock()
	lead := p.leadEventsLocked(false)
	p.Unlock()
	found := false
	for _, e := range lead {
		if e.GetEventId() == event.EventIdOwnerProfile {
			found = true
		}
	}
	if !found {
		t.Error("lead events miss the owner profile")
	}

	p.setOwnerCharacter(giantOwnerId+5, "other")
	p.Lock()
	cleared := p.ownerProfile == nil
	p.Unlock()
	if !cleared {
		t.Error("owner change must clear the profile")
	}
}

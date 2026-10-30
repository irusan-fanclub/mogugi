package app

import (
	"reflect"
	"strconv"

	"github.com/irusan-fanclub/mogugi/lib/event"
	"github.com/irusan-fanclub/mogugi/lib/packet"
)

// ownerProfileEventLocked wraps the cached profile. Caller holds t.Lock and
// guarantees ownerProfile != nil.
func (t *eventPublisher) ownerProfileEventLocked(at int64) *event.EventOwnerProfile {
	return &event.EventOwnerProfile{
		EventBase: event.EventBase{
			EventId: event.EventIdOwnerProfile,
			At:      at,
			Id:      strconv.FormatUint(t.ownerId, 10),
		},
		Profile: *t.ownerProfile,
	}
}

// publishOwnerProfile re-reads the owner's titles, grandmaster talent and
// arcana from a 0x5209 snapshot and publishes them when they changed. A
// section the walker could not read is sent as null.
func (t *eventPublisher) publishOwnerProfile(p *packet.GamePacket) {
	prof, err := packet.ParseOwnerProfile(p.Msg)
	if err != nil {
		itemLogger.Printf("owner profile: %v", err)
	}
	t.Lock()
	if t.ownerProfile != nil && reflect.DeepEqual(*t.ownerProfile, prof) {
		t.Unlock()
		return
	}
	t.ownerProfile = &prof
	e := t.ownerProfileEventLocked(p.At.Unix())
	t.Unlock()
	t.publish(e)
}

// handleEquipTitleReply applies 0x8FC7 (Int first, Int second): the server's
// confirmation of an equipped-title change. It only rewrites the two titles
// of the cached profile; nothing happens before the first snapshot.
func (t *eventPublisher) handleEquipTitleReply(p *packet.GamePacket) {
	if len(p.Msg) < 2 ||
		p.Msg[0].Type() != packet.MessageElemTypeInt ||
		p.Msg[1].Type() != packet.MessageElemTypeInt {
		return
	}
	first, _ := p.Msg[0].Data().(uint32)
	second, _ := p.Msg[1].Data().(uint32)

	t.Lock()
	if p.Id == 0 || p.Id != t.ownerId || t.ownerProfile == nil {
		t.Unlock()
		return
	}
	next := *t.ownerProfile
	next.Titles = &packet.OwnerTitles{TitleId: first, OptionTitleId: second}
	if reflect.DeepEqual(*t.ownerProfile, next) {
		t.Unlock()
		return
	}
	t.ownerProfile = &next
	e := t.ownerProfileEventLocked(p.At.Unix())
	t.Unlock()
	t.publish(e)
}

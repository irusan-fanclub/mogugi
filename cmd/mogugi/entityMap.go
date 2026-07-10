package main

import (
	"time"

	"github.com/irusan-fanclub/mabidilmeter/lib/packet"
)

type entityCache map[uint64]*entityInfoExtend

// entityInfoExtend holds per-entity state. All fields are guarded by the
// eventPublisher's mutex — do NOT add a separate mutex here. The previous
// per-entry sync.Mutex caused races because callers (addClient, loop) used
// different locks for map-level vs entry-level access.
type entityInfoExtend struct {
	*packet.EntityInfo
	appearAt              int64
	disappearAt           int64
	characterConditionMap map[uint32]*packet.EntityCharacterCondition
	equipItemMap          map[uint32]*packet.EntityItem
}

func (t entityCache) add(p *packet.EntityInfo, at time.Time) {
	if e, ok := t[p.Id]; ok {
		e.EntityInfo = p
		e.appearAt = at.Unix()
		e.disappearAt = 0
		return
	}

	t[p.Id] = &entityInfoExtend{
		EntityInfo:            p,
		appearAt:              at.Unix(),
		disappearAt:           0,
		characterConditionMap: make(map[uint32]*packet.EntityCharacterCondition),
		equipItemMap:          make(map[uint32]*packet.EntityItem),
	}

	t.cleanup(at)
}

func (t entityCache) disappear(id uint64, at time.Time) {
	e := t[id]
	if e == nil {
		return
	}

	e.disappearAt = at.Unix()
}

func (t entityCache) addCondition(p *packet.CharacterConditionPacket) {
	e := t[p.Id]
	if e == nil {
		return
	}

	if !p.IsEnable {
		delete(e.characterConditionMap, p.CCId)
		return
	}

	e.characterConditionMap[p.CCId] = &p.EntityCharacterCondition
}

func (t entityCache) addOrUpdateCondition(id uint64, p *packet.EntityCharacterCondition) bool {
	e := t[id]
	if e == nil {
		return false
	}

	if cond := e.characterConditionMap[p.CCId]; cond != nil {
		if *cond == *p {
			return false
		}
		*cond = *p
		return true
	}

	e.characterConditionMap[p.CCId] = p
	return true
}

func (t entityCache) addOrUpdateEquipItem(id uint64, p *packet.EntityItem) bool {
	e := t[id]
	if e == nil {
		return false
	}

	if item := e.equipItemMap[p.PocketType]; item != nil {
		if *item == *p {
			return false
		}
		*item = *p
		return true
	}

	e.equipItemMap[p.PocketType] = p
	return true
}

func (t entityCache) hasEquipItem(id uint64, pocketType uint32) bool {
	e := t[id]
	if e == nil {
		return false
	}
	return e.equipItemMap[pocketType] != nil
}

func (t entityCache) allEquipItemPockets(id uint64) []uint32 {
	e := t[id]
	if e == nil {
		return nil
	}

	var pockets []uint32
	for k := range e.equipItemMap {
		pockets = append(pockets, k)
	}
	return pockets
}

func (t entityCache) unequipItem(id uint64, pocketType uint32) {
	e := t[id]
	if e == nil {
		return
	}
	delete(e.equipItemMap, pocketType)
}

func (t entityCache) updateBody(id uint64, height float32, weight float32, upper float32, lower float32) {
	e := t[id]
	if e == nil {
		return
	}

	e.Height = height
	e.Weight = weight
	e.Upper = upper
	e.Lower = lower
}

func (t entityCache) cleanup(at time.Time) {
	now := at.Unix()
	mobRemoveSec, userRemoveSec := int64(1*60), int64(5*60)
	noDisappearMobRemoveSec, noDisappearUserRemoveSec := int64(12*60*60), int64(3*60*60)

	for k, v := range t {
		if v.disappearAt == 0 {
			// Never received a disappear event.
			if v.IsUser() {
				if now-v.appearAt > noDisappearUserRemoveSec {
					delete(t, k)
				}
			} else {
				if now-v.appearAt > noDisappearMobRemoveSec {
					delete(t, k)
				}
			}
			continue
		}

		// Disappear event has been received.
		if v.IsUser() {
			if now-v.disappearAt > userRemoveSec {
				delete(t, k)
			}
			continue
		}

		if now-v.disappearAt > mobRemoveSec {
			delete(t, k)
		}
	}
}

func (t *entityInfoExtend) IsUser() bool {
	switch t.RaceId {
	case 8001, 8002, 9001, 9002, 10001, 10002:
		return true
	}
	return false
}

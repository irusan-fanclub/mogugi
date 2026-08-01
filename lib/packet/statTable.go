package packet

// Character stats travel in two shapes, both using the same stat ids:
//
//	0x7530 / 0x7532  delta — (byte type, int count) then count × (int id, value)
//	0x5209           full snapshot — positional, element 30 holds stat 26, so
//	                 element i holds stat i-4; the only packet carrying the
//	                 *base* values (a delta never resends an unchanged stat).
//
// Ids are Aura's Stat enum shifted by +2 in the 26..99 range; 109 and up hold
// the equipped weapon's numbers. Verified against the character panel of
// 地域磨菇 (capture 1785411156) and against Race.xml for eight pet races
// (capture 1785312528). See MabiNotes Packets/op_0x7530_StatUpdatePrivate.md.
const (
	StatCombatPower   uint16 = 26
	StatLife          uint16 = 28
	StatLifeMaxBase   uint16 = 30
	StatLifeMaxMod    uint16 = 31
	StatMana          uint16 = 32
	StatManaMaxBase   uint16 = 33
	StatManaMaxMod    uint16 = 34
	StatStamina       uint16 = 35
	StatStaminaMaxBse uint16 = 36
	StatStaminaMaxMod uint16 = 37
	StatLevel         uint16 = 40
	StatStr           uint16 = 47
	StatStrMod        uint16 = 48
	StatDex           uint16 = 49
	StatDexMod        uint16 = 50
	StatInt           uint16 = 51
	StatIntMod        uint16 = 52
	StatWill          uint16 = 53
	StatWillMod       uint16 = 54
	StatLuck          uint16 = 55
	StatLuckMod       uint16 = 56
	StatAbilityPoints uint16 = 65

	// Dual-wield block: populated only while two weapons are equipped, and
	// zeroed the moment a single weapon is.
	StatLeftAttackMin  uint16 = 74
	StatLeftAttackMax  uint16 = 75
	StatRightAttackMin uint16 = 76
	StatRightAttackMax uint16 = 77

	StatMagicDefenseMod    uint16 = 86
	StatMagicProtectionMod uint16 = 87
	StatMagicAttackMod     uint16 = 88
	StatProtectionMod      uint16 = 94
	StatDefenseMod         uint16 = 96

	// Single-weapon block, anchored on pets whose Race.xml lists these.
	StatAttackMin uint16 = 109
	StatAttackMax uint16 = 110
	StatInjuryMin uint16 = 111
	StatInjuryMax uint16 = 112
	StatCritical  uint16 = 115
	StatBalance   uint16 = 118
)

// statSnapshotFirst is the 0x5209 element index holding the first stat, and
// statSnapshotIdOffset the gap between element index and stat id.
const (
	statSnapshotFirst    = 30
	statSnapshotIdOffset = 4
	// The block runs well past this, but nothing above it is understood yet.
	statSnapshotLastId = 210
)

// StatTable maps a stat id to its value.
type StatTable map[uint16]float64

func statValue(e IMessageElem) (float64, bool) {
	switch v := e.Data().(type) {
	case uint8:
		return float64(v), true
	case uint16:
		return float64(v), true
	case uint32:
		return float64(v), true
	case uint64:
		return float64(v), true
	case float32:
		return float64(v), true
	}
	return 0, false
}

// ParseStatUpdate reads the (id, value) pairs of a 0x7530 / 0x7532 delta.
func ParseStatUpdate(msg Message) StatTable {
	const head = 2
	if len(msg) < head || msg[1].Type() != MessageElemTypeInt {
		return nil
	}
	count := int(msg[1].Data().(uint32))

	st := make(StatTable, count)
	for i := range count {
		k := head + i*2
		if k+1 >= len(msg) || msg[k].Type() != MessageElemTypeInt {
			break
		}
		if v, ok := statValue(msg[k+1]); ok {
			st[uint16(msg[k].Data().(uint32))] = v
		}
	}
	return st
}

// ParseStatSnapshot reads the positional stat block of a 0x5209 owner
// snapshot. Non-numeric stats (155 is the last spawn point, a string) are
// skipped without shifting the ids that follow.
func ParseStatSnapshot(msg Message) StatTable {
	if len(msg) <= statSnapshotFirst {
		return nil
	}
	st := make(StatTable, statSnapshotLastId)
	for i := statSnapshotFirst; i < len(msg); i++ {
		id := uint16(i - statSnapshotIdOffset)
		if id > statSnapshotLastId {
			break
		}
		if v, ok := statValue(msg[i]); ok {
			st[id] = v
		}
	}
	return st
}

// Merge overlays a delta onto the table.
func (t StatTable) Merge(delta StatTable) {
	for k, v := range delta {
		t[k] = v
	}
}

// Panel is the subset of the character window that the wire actually
// determines. The five stats' totals, the defence/protection base and the
// 傷害 range are NOT here: the client derives those from level, skills and
// arcana, and the packets carry only the parts below.
type Panel struct {
	CombatPower   float64
	Life, LifeMax float64
	Mana, ManaMax float64

	Stamina, StaminaMax  float64
	Level, AbilityPoints float64

	// Base values — what the character window shows in parentheses.
	Str, Dex, Int, Will, Luck float64
	// Equipment/buff part of the same stats. The window's total is larger
	// still (arcana and talents are added client-side).
	StrMod, DexMod, IntMod, WillMod, LuckMod float64

	// Weapon numbers. With two weapons equipped the 109 block is empty and
	// each hand reports separately; AttackMin/Max is then the right hand.
	DualWield                  bool
	AttackMin, AttackMax       float64
	OffAttackMin, OffAttackMax float64
	InjuryMin, InjuryMax       float64
	Critical, Balance          float64

	MagicAttackMod                      float64
	DefenseMod, ProtectionMod           float64
	MagicDefenseMod, MagicProtectionMod float64
}

// Panel derives the character-window values from the stat table.
func (t StatTable) Panel() Panel {
	p := Panel{
		CombatPower:   t[StatCombatPower],
		Life:          t[StatLife],
		LifeMax:       t[StatLifeMaxBase] + t[StatLifeMaxMod],
		Mana:          t[StatMana],
		ManaMax:       t[StatManaMaxBase] + t[StatManaMaxMod],
		Stamina:       t[StatStamina],
		StaminaMax:    t[StatStaminaMaxBse] + t[StatStaminaMaxMod],
		Level:         t[StatLevel],
		AbilityPoints: t[StatAbilityPoints],

		Str: t[StatStr], Dex: t[StatDex], Int: t[StatInt], Will: t[StatWill], Luck: t[StatLuck],
		StrMod: t[StatStrMod], DexMod: t[StatDexMod], IntMod: t[StatIntMod],
		WillMod: t[StatWillMod], LuckMod: t[StatLuckMod],

		InjuryMin: t[StatInjuryMin], InjuryMax: t[StatInjuryMax],
		Critical: t[StatCritical], Balance: t[StatBalance],

		MagicAttackMod:     t[StatMagicAttackMod],
		DefenseMod:         t[StatDefenseMod],
		ProtectionMod:      t[StatProtectionMod],
		MagicDefenseMod:    t[StatMagicDefenseMod],
		MagicProtectionMod: t[StatMagicProtectionMod],
	}

	p.DualWield = t[StatLeftAttackMax] > 0 || t[StatRightAttackMax] > 0
	if p.DualWield {
		p.AttackMin, p.AttackMax = t[StatRightAttackMin], t[StatRightAttackMax]
		p.OffAttackMin, p.OffAttackMax = t[StatLeftAttackMin], t[StatLeftAttackMax]
	} else {
		p.AttackMin, p.AttackMax = t[StatAttackMin], t[StatAttackMax]
	}
	return p
}

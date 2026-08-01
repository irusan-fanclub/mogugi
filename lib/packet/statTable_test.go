package packet

import (
	"math"
	"testing"
)

// Stat values ride the wire as float32, so compare at that precision.
func closeTo(got, want float64) bool {
	return math.Abs(got-want) < 0.01
}

// statUpdateMsg builds a 0x7530/0x7532 body: (byte type, int count) then
// count × (int statId, value).
func statUpdateMsg(count uint32, pairs ...IMessageElem) Message {
	m := Message{NewMessageElemByte(3), NewMessageElemInt(count)}
	return append(m, pairs...)
}

// 0x7530 is a delta stream: every packet carries only the stats that changed,
// as (id, value) pairs whose element type varies per stat.
func TestParseStatUpdate(t *testing.T) {
	msg := statUpdateMsg(4,
		NewMessageElemInt(31), NewMessageElemFloat(4474.96), // LifeMaxMod
		NewMessageElemInt(34), NewMessageElemFloat(2457),
		NewMessageElemInt(40), NewMessageElemShort(200), // Level
		NewMessageElemInt(65), NewMessageElemInt(82690), // AP
	)

	st := ParseStatUpdate(msg)

	for id, want := range map[uint16]float64{31: 4474.96, 34: 2457, 40: 200, 65: 82690} {
		if got := st[id]; !closeTo(got, want) {
			t.Errorf("stat %d = %v, want %v", id, got, want)
		}
	}
	if len(st) != 4 {
		t.Errorf("parsed %d stats, want 4", len(st))
	}
}

// The count field bounds the pair run; the regen lists that follow it must not
// be read as stats.
func TestParseStatUpdateStopsAtCount(t *testing.T) {
	msg := statUpdateMsg(1,
		NewMessageElemInt(40), NewMessageElemShort(200),
		NewMessageElemInt(4), NewMessageElemInt(1), // first regen entry, not a stat
	)

	st := ParseStatUpdate(msg)

	if len(st) != 1 || st[40] != 200 {
		t.Errorf("got %v, want only stat 40 = 200", st)
	}
}

// snapshotMsg builds a 0x5209 head (30 elements) plus a positional stat block;
// element 30 carries stat 26, so element i carries stat i-4.
func snapshotMsg(stats ...IMessageElem) Message {
	m := make(Message, 30)
	for i := range m {
		m[i] = NewMessageElemInt(0)
	}
	return append(m, stats...)
}

// The owner snapshot is the only packet that carries the *base* stats
// (0x7530 never resends them), positionally rather than as id/value pairs.
// Values from capture 1785411156, character 地域磨菇.
func TestParseStatSnapshot(t *testing.T) {
	msg := snapshotMsg(
		NewMessageElemInt(89557),     // 26 CombatPower
		NewMessageElemShort(11),      // 27
		NewMessageElemFloat(8018.95), // 28 Life
		NewMessageElemFloat(13361.9), // 29
		NewMessageElemFloat(3611),    // 30 LifeMax base
		NewMessageElemFloat(4407.95), // 31 LifeMaxMod
	)

	st := ParseStatSnapshot(msg)

	for id, want := range map[uint16]float64{26: 89557, 28: 8018.95, 30: 3611, 31: 4407.95} {
		if got := st[id]; !closeTo(got, want) {
			t.Errorf("stat %d = %v, want %v", id, got, want)
		}
	}
}

// A String stat (155 = last spawn point) sits in the middle of the block and
// must not shift the ids that follow it.
func TestParseStatSnapshotSkipsNonNumeric(t *testing.T) {
	stats := make([]IMessageElem, 0, 132)
	for i := 26; i <= 157; i++ {
		switch i {
		case 155:
			stats = append(stats, NewMessageElemString("Uladh_Dunbarton/x/y"))
		case 156:
			stats = append(stats, NewMessageElemShort(9))
		default:
			stats = append(stats, NewMessageElemShort(0))
		}
	}

	st := ParseStatSnapshot(snapshotMsg(stats...))

	if _, ok := st[155]; ok {
		t.Error("string stat 155 must not be stored as a number")
	}
	if st[156] != 9 {
		t.Errorf("stat 156 = %v, want 9 (ids after a string stay aligned)", st[156])
	}
}

// Panel values reconstructed from capture 1785411156 (地域磨菇, equipment
// slot 2) against the in-game character window.
func TestPanelFromStatTable(t *testing.T) {
	st := StatTable{
		StatCombatPower: 89557,
		StatLife:        8086.04, StatLifeMaxBase: 3611, StatLifeMaxMod: 4474.96,
		StatMana: 4936.65, StatManaMaxBase: 3515, StatManaMaxMod: 2457,
		StatStamina: 5245.73, StatStaminaMaxBse: 3368, StatStaminaMaxMod: 2009,
		StatLevel: 200, StatAbilityPoints: 82690,
		StatStr: 1877.75, StatDex: 1838.25, StatInt: 2394.25, StatWill: 1210.25, StatLuck: 769.25,
		StatMagicAttackMod: 131, StatDefenseMod: 84, StatProtectionMod: 45,
		StatMagicDefenseMod: 70, StatMagicProtectionMod: 40,
		StatLeftAttackMin: 260, StatLeftAttackMax: 436,
		StatRightAttackMin: 364, StatRightAttackMax: 499,
	}

	p := st.Panel()

	for _, c := range []struct {
		name string
		got  float64
		want float64
	}{
		{"戰鬥力", p.CombatPower, 89557},
		{"生命上限", p.LifeMax, 8085.96},
		{"魔法上限", p.ManaMax, 5972},
		{"耐力上限", p.StaminaMax, 5377},
		{"等級", p.Level, 200},
		{"AP", p.AbilityPoints, 82690},
		{"力量base", p.Str, 1877.75},
		{"魔攻加成", p.MagicAttackMod, 131},
		{"主手攻擊最小", p.AttackMin, 364},
		{"主手攻擊最大", p.AttackMax, 499},
		{"副手攻擊最小", p.OffAttackMin, 260},
	} {
		if !closeTo(c.got, c.want) {
			t.Errorf("%s = %v, want %v", c.name, c.got, c.want)
		}
	}
	if !p.DualWield {
		t.Error("DualWield = false, want true (74-77 populated)")
	}
}

// With one weapon the dual-wield block is zeroed and the numbers move to the
// 109 block (equipment slot 3 of the same capture).
func TestPanelSingleWeapon(t *testing.T) {
	st := StatTable{
		StatAttackMin: 99, StatAttackMax: 257,
		StatInjuryMin: 35, StatInjuryMax: 60,
		StatCritical: 71, StatBalance: 72,
		StatLeftAttackMin: 0, StatRightAttackMax: 0,
	}

	p := st.Panel()

	if p.DualWield {
		t.Error("DualWield = true, want false")
	}
	if !closeTo(p.AttackMin, 99) || !closeTo(p.AttackMax, 257) {
		t.Errorf("攻擊 = %v~%v, want 99~257", p.AttackMin, p.AttackMax)
	}
	if !closeTo(p.InjuryMin, 35) || !closeTo(p.Critical, 71) || !closeTo(p.Balance, 72) {
		t.Errorf("傷口/爆擊/平衡 = %v/%v/%v, want 35/71/72", p.InjuryMin, p.Critical, p.Balance)
	}
	if p.OffAttackMax != 0 {
		t.Errorf("OffAttackMax = %v, want 0", p.OffAttackMax)
	}
}

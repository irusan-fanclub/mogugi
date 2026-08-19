package packet

import "fmt"

//go:generate go run gen_opcode_string.go

type OpCode uint32

// OpCode constants use decimal literals to match the game server's
// documentation (which uses decimal op numbers).
const (
	OpcodeChannelCharacterInfoR    OpCode = 21001 // 0x5209 owner-only full snapshot
	OpcodeEntityAppear             OpCode = 21004 // 0x520c
	OpcodeEntityDisappear          OpCode = 21005 // 0x520d
	OpcodeCreatureBodyUpdate       OpCode = 21006 // 0x520e
	OpcodeItemAppear               OpCode = 21009 // 0x5211
	OpcodeItemDisappear            OpCode = 21010 // 0x5212
	OpcodeChat                     OpCode = 21100 // 0x526c
	OpcodeNotice                   OpCode = 21101 // 0x526d
	OpcodeUnknownWarp              OpCode = 21102 // 0x526e
	OpcodeEntitiesAppear           OpCode = 21300 // 0x5334
	OpcodeEntitiesDisappear        OpCode = 21301 // 0x5335
	OpcodeIsNowDead                OpCode = 21500 // 0x53fc
	OpcodeEquipmentChanged         OpCode = 23014 // 0x59e6
	OpcodeUnequipment              OpCode = 23015 // 0x59e7
	OpcodeItemDurabilityUpdate     OpCode = 23509 // 0x5bd5
	OpcodeMissionState             OpCode = 22007 // (byte, long, string "enter_<code>", string) — mission enter, precedes the dynamic-region 26009
	OpcodeMissionStart             OpCode = 45004 // (int missionId, int) — broadcast at dynamic-instance start, 2ms before 26009; id resolves via DungeonGuide. Not seen since the 2026-07-23 game update; 36000 kind-7 carries the id now
	OpcodeQuestInfo                OpCode = 36000 // 0x8ca0 quest-journal entry: (int, long, byte, long, byte kind, int id, string name, ...); kind 7 = dungeon mission, precedes the dynamic-region 26009
	OpcodeBGMPlay                  OpCode = 43302 // (string "Xxx.mp3", int) — play BGM; Boss_*.mp3 marks a boss-fight start (43303 = preload list)
	OpcodeSetLocation              OpCode = 26009 // 0x6599 own warp/spawn: (byte 1, region, x, y) — sent on map change & channel-in
	OpcodeDynamicRegionList        OpCode = 43424 // 0xA9A0 warp into a dungeon instance + the whole instance's region table: (long eid, int fromRegion, int toRegion, int x, int y, int 16, int count) then count × (int dynamicId, string name, int flags, int baseId, string baseName, int lighting, byte, string variationPath, byte). TW multi-region form of Aura's 0x9571 EnterDynamicRegion
	OpcodeForceWalk                OpCode = 25995 // 0x659b
	OpcodeFlying                   OpCode = 26031 // 0x65af
	OpcodeChangeStanceRes          OpCode = 28201 // 0x6e29
	OpcodeChangeStance             OpCode = 28202 // 0x6e2a
	OpcodeStatUpdatePrivate        OpCode = 30000 // 0x7530
	OpcodeStatUpdatePublic         OpCode = 30002 // 0x7532
	OpcodeEntityRelated            OpCode = 30004 // 0x7534
	OpcodeCombatTargetUpdate       OpCode = 31002 // 0x791a
	OpcodeSetCombatTarget          OpCode = 31008 // 0x7920
	OpcodeSetFinisher              OpCode = 31009 // 0x7921
	OpcodeSetFinisher2             OpCode = 31010 // 0x7922
	OpcodeCombatAction             OpCode = 31014 // 0x7926
	OpcodeCombatAttackRes          OpCode = 32001 // 0x7d01
	OpcodeEffect                   OpCode = 37009 // 0x9091
	OpcodeEffect2                  OpCode = 37011 // 0x9093 generic effect; first int is a kind discriminator, and each kind has its own element shape. Kind 806 is (int 806, short skillId, short) — a skill cast, including non-damaging ones (capture 1786105610)
	OpcodeEffectDelayed            OpCode = 37013 // 0x9095
	OpcodeSkillPrepareStart        OpCode = 27012 // 0x6984 owner-only skill charge start: first elem is a Short skillId, then one of three tails (Int)/(String)/(String, Long) — ignore the tail
	OpcodeSkillStop                OpCode = 27019 // 0x698B owner-only skill charge stop: (Byte, Byte), no skillId — pair with the last 0x6984 to recover it
	OpcodeCharacterConditionUpdate OpCode = 41000 // 0xa028 buff/debuff on-off; see iruneko op_0x0000A028_CharacterConditionUpdate.md (the "2" suffix dated from a believed 0xa027, since refuted)
	OpcodePartyWindowUpdate        OpCode = 42044 // 0xa43c
	OpcodeBeautyRoomList           OpCode = 38602 // 0x96ca beauty-room list: (byte, string account-id, int count, long 0), count item records (0x5209 shape), then style-state triples
	OpcodeBankList                 OpCode = 29202 // 0x7212 bank list, one packet per race page: (byte, byte page, long, byte, string account-id, string branch, string branch-name, long gold, int tabs), then per-tab sections
	OpcodeWalking                  OpCode = 0xfd13021
	OpcodeRunning                  OpCode = 0xf44bba3
)

// String returns the constant name for the opcode if known, or its
// numeric value (hex) otherwise.
func (t OpCode) String() string {
	if s, ok := OpCodeStringMap[uint32(t)]; ok {
		return s
	}
	return fmt.Sprintf("0x%04X", uint32(t))
}

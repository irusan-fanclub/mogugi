import type { IndexItem } from '@/lib/itemIndex';

export type eventId = number;

export const eventIdEntityAppear = 1;
export const eventIdEntityDisappear = 2;
export const eventIdDamage = 3;
export const eventIdCharacterConditionEnable = 4;
export const eventIdCharacterConditionDisable = 5;
export const eventIdFinish = 6;
export const eventIdEntityEquipItem = 7;
export const eventIdEntityUnequipItem = 8;
export const eventIdEntityUpdateBody = 9;
export const eventIdStatUpdate = 10;
export const eventIdChat = 11;
export const eventIdNotice = 12;
export const eventIdChangeStance = 13;
export const eventIdOwnerCharacter = 14;
export const eventIdSkillCast = 15;
export const eventIdBardsong = 16;
export const eventIdSkillUse = 17;
export const eventIdSkillPrepareStart = 18;
export const eventIdSkillStop = 19;
export const eventIdMaxLife = 20;
export const eventIdEntityDown = 21;
export const eventIdCaptureStatus = 22;
export const eventIdOwnerEquipment = 23;
export const eventIdOwnerStats = 24;
export const eventIdBardsongPulse = 25;
export const eventIdEntityLife = 26;
export const eventIdEntityDeath = 27;
export const eventIdEntityInvincible = 28;
export const eventIdClockShift = 29;
export const eventIdOwnerProfile = 30;

export const eventIdMessageBox = -1;
export const eventIdSessionReset = -2;
export const eventIdConfigChanged = -3;
export const eventIdSourceChanged = -4;
export const eventIdHistoryEvicted = -5;
export const eventIdBattleBoundary = -6;

export type eventBase = {
    EventId: eventId;
    At: number;
    Id: string;
}

export type eventEntityAppear = eventBase & {
    EventId: 1;
    Name: string;
    RaceId: number;
    Height: number;
    Weight: number;
    Upper: number;
    Lower: number;
    GuildName: string;
    OwnerId: string;
    // Look fields: absent in old records and when the value is 0.
    SkinColor?: number;
    EyeType?: number;
    EyeColor?: number;
    LeftEyeColor?: number;
    RightEyeColor?: number;
    MouthType?: number;
}

export type eventDamage = eventBase & {
    EventId: 3;
    TargetId: string;
    SkillId: number;
    Damage: number;
    IsCritical: boolean;
    IsDelayed: boolean;
    /** The killing blow; absent in older logs. */
    IsFinish?: boolean;
}

export type eventCharacterConditionEnable = eventBase & {
    EventId: 4;
    CCId: number;
    DisableAt: number;
    AttackerId: string;
    /** Clock generation DisableAt was converted under; absent = 0. */
    ClockGen?: number;
    /** DisableAt comes from capture time, so clock shifts never apply. */
    LocalClock?: boolean;
    /** KEY -> value from the condition parameter string. Broadcast (all party members). */
    Params: Record<string, string>;
}

export type eventCharacterConditionDisable = eventBase & {
    EventId: 5;
    CCId: number;
}

export type eventFinish = eventBase & {
    EventId: 6;
    AttackerId: string;
}

export type eventEntityEquipItem = eventBase & {
    EventId: 7;
    PocketType: number;
    ItemId: number;
    Color1: string;
    Color2: string;
    Color3: string;
    Color5: string;
    Color6: string;
    Color7: string;
}

export type eventEntityUnequipItem = eventBase & {
    EventId: 8;
    PocketType: number;
    ItemId: number;
}

export type eventEntityUpdateBody = eventBase & {
    EventId: 9;
    Height: number;
    Weight: number;
    Upper: number;
    Lower: number;
}

export type eventStatUpdate = eventBase & {
    EventId: 10;
    Data: string; // base64-encoded raw bytes
}

export type eventChat = eventBase & {
    EventId: 11;
    Channel: number;
    From: string;
    Message: string;
}

/** Category separates a message about the local character (4) from
 *  server-wide (2) and world-event (3) broadcasts. */
export type eventNotice = eventBase & {
    EventId: 12;
    Category: number;
    Message: string;
}

export type eventChangeStance = eventBase & {
    EventId: 13;
    Stance: number;
}

export type eventOwnerCharacter = eventBase & {
    EventId: 14;
    Name: string;
}

/** Id is the caster. Fires for buffs too, unlike eventDamage's SkillId. */
export type eventSkillCast = eventBase & {
    EventId: 15;
    SkillId: number;
}

/** Song is the raw remainder of the announcement's first line, not a bare
 *  song name — isolating one needs a BardsSong.xml template table. */
export type eventBardsong = eventBase & {
    EventId: 16;
    Performer: string;
    Song: string;
    Bonuses: Record<string, number>;
    IsEnd: boolean;
}

/** One pulse of a playing bard song, keyed by the performer. Targets are the
 *  entities the song reached this pulse; empty with Stop when it ends. */
export type eventBardsongPulse = eventBase & {
    EventId: 25;
    Targets: string[];
    Stop: boolean;
}

/** Fires from the broadcast combat-action packet (0x7926), damaging or not
 *  — the only broadcast source that also sees buff and utility skills. */
export type eventSkillUse = eventBase & {
    EventId: 17;
    SkillId: number;
}

/** Fires when the local player starts channeling a skill (0x6984).
 *  Self-only: no broadcast source sees this for anyone else. */
export type eventSkillPrepareStart = eventBase & {
    EventId: 18;
    SkillId: number;
}

/** Fires when the local player's channeled skill ends (0x698B). The
 *  opcode carries no skill id; SkillId is the one from the matching
 *  eventSkillPrepareStart. */
export type eventSkillStop = eventBase & {
    EventId: 19;
    SkillId: number;
}

export type eventEntityLife = eventBase & {
    EventId: 26;
    Life: number;
}

export type eventEntityDeath = eventBase & {
    EventId: 27;
    Dead: boolean;
}

/** 0x7533: the boss cannot be damaged while On. */
export type eventEntityInvincible = eventBase & {
    EventId: 28;
    On: boolean;
}

/** The server clock estimate moved: every published local DisableAt shifts by ShiftSec. */
export type eventClockShift = eventBase & {
    EventId: 29;
    ShiftSec: number;
    /** Clock generation this shift creates; only conditions of an older generation move. */
    Gen: number;
}

export type eventMaxLife = eventBase & {
    EventId: 20;
    MaxLife: number;
}

/** Live capture health from the connection watchdog; LastPacketAt is 0 if
 *  no reader has ever been installed. */
export type eventCaptureStatus = eventBase & {
    EventId: 22;
    NpcapOk: boolean;
    GameDetected: boolean;
    Capturing: boolean;
    LastPacketAt: number;
}

/** One worn item of the local character; item is the /api/item-index shape. */
export type ownerEquipmentItem = { pocket: number; eid: string; item: IndexItem };

/** The local character's whole worn set; replaces, never patches. */
export type eventOwnerEquipment = eventBase & {
    EventId: 23;
    Items: ownerEquipmentItem[];
}

/** packet.Panel: what the wire determines of the character window. */
export type ownerPanel = {
    combatPower: number;
    life: number; lifeMax: number; lifeMaxMod: number;
    mana: number; manaMax: number; manaMaxMod: number;
    stamina: number; staminaMax: number; staminaMaxMod: number;
    level: number; cumulatedLevel: number; charType: number; abilityPoints: number;
    str: number; dex: number; int: number; will: number; luck: number;
    strMod: number; dexMod: number; intMod: number; willMod: number; luckMod: number;
    dualWield: boolean;
    attackMin: number; attackMax: number; offAttackMin: number; offAttackMax: number;
    injuryMin: number; injuryMax: number; critical: number; balance: number;
    magicAttackMod: number; defenseMod: number; protectionMod: number;
    magicDefenseMod: number; magicProtectionMod: number;
}

export type eventOwnerStats = eventBase & {
    EventId: 24;
    Panel: ownerPanel;
}

/** packet.OwnerProfile; a section is null when the backend could not read it. */
export type ownerProfile = {
    titles: { titleId: number; optionTitleId: number } | null;
    talent: { grandmasterTalentId: number; ownedTitleIds: number[] } | null;
    multiClass: {
        currentClassId: number;
        classes: { classId: number; exp: number; arcanaLevel: number }[];
    } | null;
}

/** The local character's titles, grandmaster talent and arcana; replaces, never patches. */
export type eventOwnerProfile = eventBase & {
    EventId: 30;
    Profile: ownerProfile;
}

export type eventMessageBox = eventBase & {
    EventId: -1;
    Message: string;
}

export type eventSessionReset = eventBase & {
    EventId: -2;
    Reason: string;
}

export type eventConfigChanged = eventBase & {
    EventId: -3;
    Config: Record<string, unknown>;
}

export type sourceState = {
    Mode: 'live' | 'replay';
    File: string;
    Done: number;
    Total: number;
    Finished: boolean;
    Err: string;
    Notice: string;
    // Detected (live) or recorded (ndjson replay) game client version; omitted when unknown.
    ClientVersion?: string;
}

export type eventSourceChanged = eventBase & sourceState & {
    EventId: -4;
}

/** Entity ids (EntityAppear Id format) the backend still holds. */
export type eventHistoryEvicted = eventBase & {
    EventId: -5;
    Present?: string[];
}

export type eventBattleBoundary = eventBase & {
    EventId: -6;
    Present?: string[];
}

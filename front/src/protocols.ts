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

export const eventIdMessageBox = -1;
export const eventIdSessionReset = -2;

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
}

export type eventDamage = eventBase & {
    EventId: 3;
    TargetId: string;
    SkillId: number;
    Damage: number;
    IsCritical: boolean;
    IsDelayed: boolean;
}

export type eventCharacterConditionEnable = eventBase & {
    EventId: 4;
    CCId: number;
    DisableAt: number;
    AttackerId: string;
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

export type eventMaxLife = eventBase & {
    EventId: 20;
    MaxLife: number;
}

export type eventMessageBox = eventBase & {
    EventId: -1;
    Message: string;
}

export type eventSessionReset = eventBase & {
    EventId: -2;
    Reason: string;
}
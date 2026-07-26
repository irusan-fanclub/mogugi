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

export type eventNotice = eventBase & {
    EventId: 12;
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

export type eventMessageBox = eventBase & {
    EventId: -1;
    Message: string;
}

export type eventSessionReset = eventBase & {
    EventId: -2;
    Reason: string;
}
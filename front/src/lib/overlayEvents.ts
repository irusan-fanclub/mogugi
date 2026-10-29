import * as p from '@/protocols';

// Mirror of overlayWants in internal/app/eventPublisher.go; both tests pin this same list.
export const OVERLAY_EVENT_IDS: readonly number[] = [
    p.eventIdEntityAppear, p.eventIdEntityDisappear, p.eventIdDamage,
    p.eventIdCharacterConditionEnable, p.eventIdCharacterConditionDisable, p.eventIdFinish,
    p.eventIdOwnerCharacter, p.eventIdSkillUse, p.eventIdMaxLife, p.eventIdEntityLife, p.eventIdEntityDeath,
];

/** What the server lets an overlay socket through (system events, id < 0, always pass). */
export const overlayWants = (e: { EventId: number }): boolean =>
    e.EventId < 0 || OVERLAY_EVENT_IDS.includes(e.EventId);

import { describe, it, expect } from 'vitest';
import {
    DEFAULT_BOSS_RACE_IDS, effectiveBossRaces, addBossRace, removeBossRace, hasBossRaceOverrides,
    type BossRaceOverrides,
} from './bossRaces';

const none: BossRaceOverrides = { added: [], removed: [] };

describe('effectiveBossRaces', () => {
    it('starts from the built-in list, which now includes 佩洛姆 (193810) but not its NPC forms', () => {
        const s = effectiveBossRaces(none);
        expect(s.has(7601)).toBe(true);
        expect(s.has(193810)).toBe(true);
        expect(s.has(193369)).toBe(false);
        expect([...s].sort()).toEqual([...DEFAULT_BOSS_RACE_IDS].sort());
    });

    it('applies user additions and removals on top of the defaults', () => {
        const s = effectiveBossRaces({ added: [123456], removed: [4856] });
        expect(s.has(123456)).toBe(true);
        expect(s.has(4856)).toBe(false);
        expect(s.has(7601)).toBe(true);
    });
});

describe('addBossRace', () => {
    it('records a non-default id once', () => {
        const o = addBossRace(addBossRace(none, 123456), 123456);
        expect(o.added).toEqual([123456]);
        expect(effectiveBossRaces(o).has(123456)).toBe(true);
    });

    it('re-adding a removed default only clears the removal', () => {
        const o = addBossRace({ added: [], removed: [4856] }, 4856);
        expect(o).toEqual(none);
    });

    it('ignores ids that are not positive integers', () => {
        expect(addBossRace(none, 0)).toEqual(none);
        expect(addBossRace(none, -5)).toEqual(none);
        expect(addBossRace(none, 12.5)).toEqual(none);
        expect(addBossRace(none, Number.NaN)).toEqual(none);
    });
});

describe('removeBossRace', () => {
    it('hides a default id by recording the removal', () => {
        const o = removeBossRace(none, 7601);
        expect(o.removed).toEqual([7601]);
        expect(effectiveBossRaces(o).has(7601)).toBe(false);
    });

    it('drops a user-added id instead of recording a removal', () => {
        const o = removeBossRace({ added: [123456], removed: [] }, 123456);
        expect(o).toEqual(none);
    });

    it('ignores ids that are neither default nor added', () => {
        expect(removeBossRace(none, 999999)).toEqual(none);
    });
});

describe('hasBossRaceOverrides', () => {
    it('is false only when both lists are empty', () => {
        expect(hasBossRaceOverrides(none)).toBe(false);
        expect(hasBossRaceOverrides({ added: [1], removed: [] })).toBe(true);
        expect(hasBossRaceOverrides({ added: [], removed: [7601] })).toBe(true);
    });
});

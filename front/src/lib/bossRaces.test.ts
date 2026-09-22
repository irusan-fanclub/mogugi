import { describe, it, expect } from 'vitest';
import {
    DEFAULT_BOSS_RACE_IDS, effectiveBossRaces, addBossRace, removeBossRace, hasBossRaceOverrides,
    matchesRaceQuery, parseRaceIdInput,
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

describe('built-in list hygiene', () => {
    it('no longer carries the unnamed placeholder 7160', () => {
        expect(effectiveBossRaces(none).has(7160)).toBe(false);
    });
});

describe('matchesRaceQuery', () => {
    it('matches a Chinese fragment of the display name', () => {
        expect(matchesRaceQuery('佩洛姆 193810', 193810, '佩洛')).toBe(true);
        expect(matchesRaceQuery('雷楠的米勒 7603', 7603, '米勒')).toBe(true);
        expect(matchesRaceQuery('佩洛姆 193810', 193810, '米勒')).toBe(false);
    });

    it('matches a RaceID by prefix, so typing digits narrows the list', () => {
        expect(matchesRaceQuery('佩洛姆 193810', 193810, '1938')).toBe(true);
        expect(matchesRaceQuery('佩洛姆 193810', 193810, '193810')).toBe(true);
        expect(matchesRaceQuery('佩洛姆 193810', 193810, '3810')).toBe(false);
    });

    it('ignores case and surrounding spaces, and an empty query matches everything', () => {
        expect(matchesRaceQuery('Vertrag 7601', 7601, ' vert ')).toBe(true);
        expect(matchesRaceQuery('佩洛姆 193810', 193810, '')).toBe(true);
    });
});

describe('parseRaceIdInput', () => {
    it('accepts a bare positive integer and rejects anything else', () => {
        expect(parseRaceIdInput(' 193810 ')).toBe(193810);
        expect(parseRaceIdInput('佩洛姆')).toBeNull();
        expect(parseRaceIdInput('12.5')).toBeNull();
        expect(parseRaceIdInput('0')).toBeNull();
        expect(parseRaceIdInput('')).toBeNull();
    });
});

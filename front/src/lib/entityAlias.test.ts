// entityAlias.test.ts — session-only alias map (vitest, pure logic).
import { describe, it, expect, beforeEach } from 'vitest';
import {
    FUNNY_NAMES, aliasOf, setAlias, clearAlias, clearAllAliases,
    randomAlias, randomizeAll, hasAnyAlias,
} from './entityAlias';

beforeEach(() => clearAllAliases());

describe('setAlias / aliasOf', () => {
    it('returns the alias once set', () => {
        setAlias('地域磨菇', '蘑菇雞');
        expect(aliasOf('地域磨菇')).toBe('蘑菇雞');
    });

    it('returns undefined for a name with no alias', () => {
        expect(aliasOf('地域磨菇')).toBeUndefined();
    });

    it('trims surrounding whitespace', () => {
        setAlias('地域磨菇', '  蘑菇雞  ');
        expect(aliasOf('地域磨菇')).toBe('蘑菇雞');
    });

    it('treats an empty alias as a clear', () => {
        setAlias('地域磨菇', '蘑菇雞');
        setAlias('地域磨菇', '   ');
        expect(aliasOf('地域磨菇')).toBeUndefined();
    });

    it('treats an alias equal to the real name as a clear', () => {
        setAlias('地域磨菇', '蘑菇雞');
        setAlias('地域磨菇', '地域磨菇');
        expect(aliasOf('地域磨菇')).toBeUndefined();
    });

    it('clearAlias removes only that entry', () => {
        setAlias('甲', '蘑菇雞');
        setAlias('乙', '哞哞叫');
        clearAlias('甲');
        expect(aliasOf('甲')).toBeUndefined();
        expect(aliasOf('乙')).toBe('哞哞叫');
    });
});

describe('hasAnyAlias', () => {
    it('is false when empty and true after an alias is set', () => {
        expect(hasAnyAlias.value).toBe(false);
        setAlias('甲', '蘑菇雞');
        expect(hasAnyAlias.value).toBe(true);
        clearAllAliases();
        expect(hasAnyAlias.value).toBe(false);
    });
});

describe('randomAlias', () => {
    it('assigns an alias different from the real name', () => {
        // A player literally called by a word-bank entry must not end up
        // aliased to itself (which setAlias would treat as a clear).
        const realName = FUNNY_NAMES[0];
        randomAlias(realName);
        expect(aliasOf(realName)).toBeDefined();
        expect(aliasOf(realName)).not.toBe(realName);
    });

    it('never reuses an alias already taken by someone else', () => {
        const names = Array.from({ length: 20 }, (_, i) => `玩家${i}`);
        for (const n of names) randomAlias(n);
        const assigned = names.map(n => aliasOf(n)!);
        expect(new Set(assigned).size).toBe(names.length);
    });

    it('re-rolling one name leaves the others untouched', () => {
        setAlias('甲', '蘑菇雞');
        setAlias('乙', '哞哞叫');
        randomAlias('甲');
        expect(aliasOf('乙')).toBe('哞哞叫');
    });
});

describe('randomizeAll', () => {
    it('gives every name a distinct alias', () => {
        const names = Array.from({ length: 30 }, (_, i) => `玩家${i}`);
        randomizeAll(names);
        const assigned = names.map(n => aliasOf(n)!);
        expect(assigned.every(Boolean)).toBe(true);
        expect(new Set(assigned).size).toBe(names.length);
    });

    it('falls back to numeric suffixes once the word bank runs out', () => {
        const names = Array.from({ length: FUNNY_NAMES.length + 5 }, (_, i) => `玩家${i}`);
        randomizeAll(names);
        const assigned = names.map(n => aliasOf(n)!);
        expect(new Set(assigned).size).toBe(names.length);
        expect(assigned.some(a => /\d$/.test(a))).toBe(true);
    });

    it('replaces the whole map rather than merging', () => {
        setAlias('舊角色', '蘑菇雞');
        randomizeAll(['甲', '乙']);
        expect(aliasOf('舊角色')).toBeUndefined();
    });

    it('never hands out an alias that collides with a real name', () => {
        const names = [FUNNY_NAMES[0], FUNNY_NAMES[1], '玩家X'];
        randomizeAll(names);
        const assigned = names.map(n => aliasOf(n)!);
        expect(assigned.some(a => names.includes(a))).toBe(false);
    });
});

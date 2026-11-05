import { describe, it, expect } from 'vitest';
import { deriveArcana, arcanaIconUrl, arcanaTitle, createArcanaTracker } from './arcana';
import { ARCANA_NAMES } from './arcanaTable';

// 59165 is real (旋律人偶師, block 59160-59169) — kept accurate so a later
// reader can't "fix" this fixture into disagreeing with arcanaTable.ts.
const map = { 59004: 2, 59083: 5, 59165: 9 };

describe('deriveArcana', () => {
    // Arcana can be switched between dungeons within one session — the most
    // recent recognised skill reflects the current arcana.
    it('returns the arcana of the LAST recognised skill', () => {
        expect(deriveArcana([12345, 59004, 59083], map)).toBe(5);
    });

    it('re-detects after a mid-session switch', () => {
        // whole previous fight as bishop, then one puppeteer skill
        expect(deriveArcana([59004, 59004, 59004, 59165], map)).toBe(9);
    });

    it('returns null when no arcana skill was used', () => {
        expect(deriveArcana([12345, 20001], map)).toBeNull();
    });

    it('returns null for an empty list', () => {
        expect(deriveArcana([], map)).toBeNull();
    });
});

describe('arcanaIconUrl', () => {
    it('maps a detected id to its own icon file', () => {
        expect(arcanaIconUrl(2)).toBe('/icons/arcana/icon_arcana_2.png');
        expect(arcanaIconUrl(4)).toBe('/icons/arcana/icon_arcana_4.png');
    });

    it('falls back to the placeholder icon when nothing was detected', () => {
        expect(arcanaIconUrl(null)).toBe('/icons/arcana/icon_arcana_0.png');
    });
});

describe('arcanaTitle', () => {
    it('names a detected arcana', () => {
        expect(arcanaTitle(9)).toBe('旋律人偶師');
    });

    // The common case: a character who only auto-attacked never used a
    // 59xxx skill, so deriveArcana settles on null for the whole fight.
    it('falls back for an undetected arcana', () => {
        expect(arcanaTitle(null)).toBe('尚未偵測到秘法技能');
    });
});

// Filenames only, so no content query/eager import is needed — we never
// call the loaders, just read which ids matched (mirrors the raw-text glob
// bardsongTrack.test.ts uses to cross-check build-data.mjs).
const arcanaIconFiles = import.meta.glob('../../../assets/icon_arcana_*.png');
const presentIds = new Set(
    Object.keys(arcanaIconFiles).map(p => Number(p.match(/icon_arcana_(\d+)\.png$/)![1])),
);

describe('arcana icon files on disk', () => {
    // Ties arcanaTable.ts to reality: adding an arcana id without shipping
    // its icon.png makes this fail, pointing straight at what's missing.
    it('has an icon file for every ARCANA_NAMES id', () => {
        const missing = Object.keys(ARCANA_NAMES).map(Number).filter(id => !presentIds.has(id));
        expect(missing).toEqual([]);
    });

    // id 0 is what arcanaIconUrl(null) points at — the most common case on
    // screen, since most characters never use a detectable arcana skill.
    it('has the placeholder icon that arcanaIconUrl(null) points at', () => {
        expect(presentIds.has(0)).toBe(true);
    });
});

describe('createArcanaTracker', () => {
    const pc = (id: string, applyDamages: any[] = [], skillUses: any[] = [], isPC = true) =>
        ({ id, isPC, applyDamages, skillUses });
    it('takes the latest arcana by At across hits and skill uses', () => {
        const t = createArcanaTracker(map);
        t.observe([pc('a', [{ At: 10, SkillId: 59004 }], [{ At: 20, SkillId: 59083 }])]);
        expect(t.of('a')).toBe(5);
        t.observe([pc('b', [{ At: 30, SkillId: 59165 }], [{ At: 20, SkillId: 59004 }])]);
        expect(t.of('b')).toBe(9);
    });
    it('ignores unknown skills and unseen players', () => {
        const t = createArcanaTracker(map);
        t.observe([pc('a', [{ At: 1, SkillId: 1 }])]);
        expect(t.of('a')).toBeNull();
        expect(t.of('nobody')).toBeNull();
    });
    it('remembers after the lists are emptied and picks up new entries', () => {
        const t = createArcanaTracker(map);
        const hits = [{ At: 10, SkillId: 59004 }];
        t.observe([pc('a', hits)]);
        t.observe([pc('a', [])]);
        expect(t.of('a')).toBe(2);
        hits.push({ At: 50, SkillId: 59165 });
        t.observe([pc('a', hits)]);
        expect(t.of('a')).toBe(9);
    });
    it('does not let older events override a newer arcana', () => {
        const t = createArcanaTracker(map);
        t.observe([pc('a', [{ At: 50, SkillId: 59165 }])]);
        t.observe([pc('a', [{ At: 10, SkillId: 59004 }])]);
        expect(t.of('a')).toBe(9);
    });
    it('ignores non-PCs', () => {
        const t = createArcanaTracker(map);
        t.observe([pc('npc', [{ At: 1, SkillId: 59004 }], [], false)]);
        expect(t.of('npc')).toBeNull();
    });
    it('skip marks lists read without taking an arcana from them', () => {
        const t = createArcanaTracker(map);
        const hits = [{ At: 50, SkillId: 59165 }];
        t.skip([pc('a', hits)]);
        t.observe([pc('a', hits)]);
        expect(t.of('a')).toBeNull();
        hits.push({ At: 60, SkillId: 59004 });
        t.observe([pc('a', hits)]);
        expect(t.of('a')).toBe(2);
    });
    it('reset forgets every player, keeps old entries read, and picks up new ones', () => {
        const t = createArcanaTracker(map);
        const hits = [{ At: 50, SkillId: 59165 }];
        t.observe([pc('a', hits)]);
        t.reset();
        expect(t.of('a')).toBeNull();
        t.observe([pc('a', hits)]);
        expect(t.of('a')).toBeNull();
        hits.push({ At: 60, SkillId: 59004 });
        t.observe([pc('a', hits)]);
        expect(t.of('a')).toBe(2);
    });
});

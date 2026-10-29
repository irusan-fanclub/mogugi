import { describe, it, expect } from 'vitest';
import { buildSkillRows, limitRows, type SkillRow } from './skillRows';

const hit = (SkillId: number, At: number, Damage: number, o: Record<string, unknown> = {}) =>
    ({ SkillId, At, Damage, IsCritical: false, IsDelayed: false, PetId: '', ...o } as never);
const base = {
    skillUses: [], showPet: true, minAt: null, maxAt: null,
    skillName: (id: number) => `s${id}`, playerSpanSec: 10,
};

describe('buildSkillRows', () => {
    it('sorts by damage desc and drops zero-damage skills', () => {
        const rows = buildSkillRows({ ...base, damages: [hit(1, 0, 10), hit(2, 1, 50), hit(3, 2, 0)] });
        expect(rows.map(r => r.skillId)).toEqual([2, 1]);
        expect(rows[0].name).toBe('s2');
        expect(rows[0].share).toBeCloseTo(50 / 60);
    });
    it('counts a delayed hit in damage but not count/crit, except 58009', () => {
        const rows = buildSkillRows({
            ...base,
            damages: [hit(1, 0, 10), hit(1, 1, 90, { IsDelayed: true }), hit(58009, 0, 5, { IsDelayed: true })],
        });
        const r1 = rows.find(r => r.skillId === 1)!;
        expect(r1.damage).toBe(100);
        expect(r1.count).toBe(1);
        expect(r1.cells.avg).toBe('0.10K');
        expect(r1.cells.critCount).toBe('0');
        const r2 = rows.find(r => r.skillId === 58009)!;
        expect(r2.count).toBe(1);
    });
    it('showPet=false drops pet hits from skill rows only', () => {
        const damages = [hit(1, 0, 10), hit(1, 1, 30, { PetId: 'p' }), hit(2, 0, 7, { PetId: 'p' })];
        const off = buildSkillRows({ ...base, damages, showPet: false });
        expect(off.map(r => [r.skillId, r.damage])).toEqual([[1, 10]]);
        const on = buildSkillRows({ ...base, damages, showPet: true });
        expect(on.map(r => [r.skillId, r.damage])).toEqual([[1, 40], [2, 7]]);
    });
    it('formats cells: critRate, hitsPerMin, castCount, summaries', () => {
        const rows = buildSkillRows({
            ...base,
            damages: [hit(1, 0, 1000, { IsCritical: true }), hit(1, 5, 3000)],
            skillUses: [{ SkillId: 1, At: 0 }, { SkillId: 1, At: 3 }, { SkillId: 1, At: 99 }],
            minAt: 0, maxAt: 50, playerSpanSec: 6,
        });
        const c = rows[0].cells;
        expect(c.critRate).toBe('50.0%');
        expect(c.hitsPerMin).toBe('20.0');
        expect(c.castCount).toBe('2');
        expect(c.critCount).toBe('1');
        expect(c.critSummary).toContain('(1,');
        expect(rows[0].dps).toBe(4000 / 5);
    });
    it('uses - for stats with no sample instead of 0K', () => {
        const c = buildSkillRows({ ...base, damages: [hit(1, 0, 1000)] })[0].cells;
        expect([c.critAvg, c.critMin, c.critMax]).toEqual(['-', '-', '-']);
        expect(c.critSummary).toBe('- (0, - ~ -)');
        expect(c.normalAvg).toBe('1.00K');
        const d = buildSkillRows({ ...base, damages: [hit(1, 0, 10, { IsDelayed: true })] })[0].cells;
        expect([d.avg, d.min, d.max]).toEqual(['-', '-', '-']);
    });
    it('uses - for unseen casts and zero span', () => {
        const rows = buildSkillRows({ ...base, damages: [hit(1, 0, 10)], playerSpanSec: 0 });
        expect(rows[0].cells.castCount).toBe('-');
        expect(rows[0].cells.hitsPerMin).toBe('-');
    });
    it('share uses totalDamage when given', () => {
        const rows = buildSkillRows({ ...base, damages: [hit(1, 0, 10)], totalDamage: 40 });
        expect(rows[0].share).toBe(0.25);
    });
});

describe('limitRows', () => {
    const rows = [1, 2, 3, 4].map(i => ({ skillId: i }) as SkillRow);
    it('limit 0 or expanded shows all', () => {
        expect(limitRows(rows, 0, false)).toEqual({ rows, hidden: 0 });
        expect(limitRows(rows, 2, true)).toEqual({ rows, hidden: 0 });
    });
    it('slices and reports hidden', () => {
        const r = limitRows(rows, 3, false);
        expect(r.rows).toHaveLength(3);
        expect(r.hidden).toBe(1);
    });
});

describe('buildSkillRows hits', () => {
    it('hits are exactly the counted hits', () => {
        const damages = [hit(1, 0, 10), hit(1, 1, 90, { IsDelayed: true }), hit(1, 2, 30, { PetId: 'p' })];
        const off = buildSkillRows({ ...base, damages, showPet: false });
        expect(off[0].hits.length).toBe(off[0].count);
        expect(off[0].hits).toEqual([damages[0]]);
        const on = buildSkillRows({ ...base, damages, showPet: true });
        expect(on[0].hits.length).toBe(on[0].count);
        expect(on[0].hits).toEqual([damages[0], damages[2]]);
    });
});

describe('buildSkillRows activeDps', () => {
    it('divides skill damage by the player active seconds', () => {
        const rows = buildSkillRows({ ...base, damages: [hit(1, 0, 100), hit(2, 1, 50)], activeSec: 5 });
        expect(rows.find(r => r.skillId === 1)!.activeDps).toBe(20);
        expect(rows.find(r => r.skillId === 2)!.activeDps).toBe(10);
    });
    it('is null when the player has no active seconds', () => {
        for (const activeSec of [null, 0, undefined]) {
            const rows = buildSkillRows({ ...base, damages: [hit(1, 0, 100)], activeSec });
            expect(rows[0].activeDps).toBeNull();
        }
    });
});


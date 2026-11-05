import { describe, it, expect } from 'vitest';
import { resolveOverlayTarget, buildDpsOverlay, formatRemaining } from './overlayModel';

const isBoss = (r: number) => r === 4856;
const dmg = (...ats: number[]) => ats.map(At => ({ At, Damage: 1 })) as any[];

describe('resolveOverlayTarget', () => {
    const actors: any = {
        a: { id: 'a', raceId: 4856, appearAt: 5 }, b: { id: 'b', raceId: 4856, appearAt: 9 }, c: { id: 'c', raceId: 1, appearAt: 99 },
    };
    it('uses the announced id, including all-targets', () => {
        expect(resolveOverlayTarget({ announced: 't1', actors, isBoss })).toBe('t1');
        expect(resolveOverlayTarget({ announced: '', actors, isBoss })).toBe('');
    });
    it('falls back to the latest boss, else all targets', () => {
        expect(resolveOverlayTarget({ announced: null, actors, isBoss })).toBe('b');
        expect(resolveOverlayTarget({ announced: null, actors: {}, isBoss })).toBe('');
    });
});

describe('buildDpsOverlay', () => {
    const mk = (id: string, total: number, ...ats: number[]): any => ({ actor: { id }, damages: dmg(...ats), totalDamage: total });
    const rows = [mk('A', 600, 0, 10), mk('B', 400, 2, 10)];
    const base = { rows, ownerId: 'A', nameOf: (id: string) => `n${id}`, boss: null };
    it('computes shares, party dps and fight time', () => {
        const vm = buildDpsOverlay(base);
        expect(vm.rows.map(r => r.share)).toEqual([0.6, 0.4]);
        expect(vm.rows.map(r => r.isSelf)).toEqual([true, false]);
        expect(vm.rows[0]).toMatchObject({ id: 'A', name: 'nA', total: 600, dps: 60 });
        expect(vm.partyDps).toBe(100);
        expect(vm.fightSec).toBe(10);
        expect(vm.boss).toBeNull();
    });
    it('boss hp percent', () => {
        const hp = (maxLife: number, dealt: number) => buildDpsOverlay({ ...base, boss: { name: 'B', maxLife, dealt } }).boss;
        expect(hp(1000, 250)).toEqual({ name: 'B', hpPct: 75, life: 750 });
        expect(hp(0, 5)?.life).toBeNull();
        expect(hp(1000, 2000)?.hpPct).toBe(0);
        expect(hp(0, 5)?.hpPct).toBeNull();
    });
    it('boss hp percent prefers the real life', () => {
        const hp = (life: number) => buildDpsOverlay({ ...base, boss: { name: 'B', maxLife: 1000, dealt: 250, life } }).boss;
        expect(hp(400)?.hpPct).toBe(40);
        expect(hp(0)?.hpPct).toBe(0);
        expect(hp(1500)?.hpPct).toBe(100);
    });
    it('empty rows', () => {
        const vm = buildDpsOverlay({ ...base, rows: [] });
        expect(vm.fightSec).toBeNull();
        expect(vm.partyDps).toBe(0);
    });
});

describe('formatRemaining', () => {
    it('formats', () => {
        expect(formatRemaining(4.2)).toBe('5');
        expect(formatRemaining(99)).toBe('99');
        expect(formatRemaining(150)).toBe('3m');
        expect(formatRemaining(7200)).toBe('');
    });
});

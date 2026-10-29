import { describe, it, expect } from 'vitest';
import {
    resolveOverlayTarget, buildDpsOverlay, activeIcons, formatRemaining, buildCcOverlay,
} from './overlayModel';

const isBoss = (r: number) => r === 4856;
const cond = (CCId: number, DisableAt: number): any => ({ Id: 'x', At: 0, CCId, DisableAt, AttackerId: '', Params: [] });
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
        expect(hp(1000, 250)).toEqual({ name: 'B', hpPct: 75 });
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

describe('activeIcons', () => {
    const now = 1000;
    it('keeps tracked order, countdown null for DisableAt 0', () => {
        const r = activeIcons({ 20: cond(20, now + 5), 10: cond(10, 0) }, [10, 20, 30], now);
        expect(r.map(i => i.ccId)).toEqual([10, 20]);
        expect(r[0].remaining).toBeNull();
        expect(r[1]).toMatchObject({ remaining: 5, expiring: false });
    });
    it('flags expiring at <= 3s', () => {
        expect(activeIcons({ 20: cond(20, now + 3) }, [20], now)[0].expiring).toBe(true);
    });
    it('hides expired conditions without a disable event', () => {
        expect(activeIcons({ 20: cond(20, now - 1) }, [20], now)).toEqual([]);
        expect(activeIcons({ 20: cond(20, now) }, [20], now)).toEqual([]);
    });
    it('merged alias satisfies the tracked id', () => {
        const r = activeIcons({ 913: cond(913, now + 9) }, [912], now);
        expect(r.map(i => i.ccId)).toEqual([912]);
        expect(r[0].remaining).toBe(9);
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

describe('buildCcOverlay', () => {
    const now = 1000;
    const actor = (c: Record<number, any>): any => ({ conditionMap: c, casts: [], isPC: false });
    const actors = {
        boss: actor({ 1: cond(1, now + 10) }),
        me: actor({ 2: cond(2, 0) }),
        p1: actor({ 2: cond(2, 0) }),
        p2: actor({ 9: cond(9, 0) }),
    };
    const sections = { boss: [1], self: [2], party: [2] };
    const i = {
        actors, bossId: 'boss', ownerId: 'me', partyIds: ['me', 'p1', 'p2', 'gone'],
        sections, now, nameOf: (id: string) => `n${id}`, red: new Set<string>(),
    };
    it('builds boss, self and filtered party rows', () => {
        const vm = buildCcOverlay(i);
        expect(vm.boss).toMatchObject({ id: 'boss', name: 'nboss' });
        expect(vm.boss!.icons.map(x => x.ccId)).toEqual([1]);
        expect(vm.self).toMatchObject({ id: 'me', name: 'nme' });
        expect(vm.party.map(r => r.id)).toEqual(['p1']);
    });
    it('a red key marks that icon expiring', () => {
        const vm = buildCcOverlay({ ...i, red: new Set(['boss:1']) });
        expect(vm.boss!.icons[0].expiring).toBe(true);
        expect(buildCcOverlay(i).boss!.icons[0].expiring).toBe(false);
    });
    it('missing boss gives null', () => {
        expect(buildCcOverlay({ ...i, bossId: 'zzz' }).boss).toBeNull();
    });
});

import { describe, it, expect } from 'vitest';
import { bossInfoOf } from './bossInfo';
import { buildDpsOverlay, fightStats } from './overlayModel';

const stats = { fightSec: 10, partyDps: 5 };
const boss = (over: Record<string, unknown> = {}) => ({
    raceId: 4856, maxLife: 1000, lifeAt: () => undefined, deathHistory: [], lifeHistory: [], ...over,
}) as never;
const base = { isBoss: (r: number) => r === 4856, name: 'B', dealt: 250, at: null, stats };

describe('bossInfoOf', () => {
    it('is null without a target, for a non-boss, or without any life data', () => {
        expect(bossInfoOf({ ...base, target: null })).toBeNull();
        expect(bossInfoOf({ ...base, target: boss({ raceId: 1 }) })).toBeNull();
        expect(bossInfoOf({ ...base, target: boss({ maxLife: 0 }) })).toBeNull();
    });
    it('derives life from maxLife minus dealt without a sample', () => {
        const vm = bossInfoOf({ ...base, target: boss() })!;
        expect(vm).toMatchObject({ life: 750, maxLife: 1000, hpPct: 75, dead: false, dealt: 250, fightSec: 10, partyDps: 5 });
    });
    it('lets a sampled life win over dealt', () => {
        const vm = bossInfoOf({ ...base, target: boss({ lifeAt: () => 150 }) })!;
        expect(vm.life).toBe(150);
        expect(vm.hpPct).toBe(15);
    });
    it('rounds the percent to one decimal and clamps to 0..100', () => {
        expect(bossInfoOf({ ...base, dealt: 333, target: boss() })!.hpPct).toBe(66.7);
        expect(bossInfoOf({ ...base, dealt: 5000, target: boss() })!.hpPct).toBe(0);
    });
    it('is dead with life 0 when the last death entry at or before `at` says so', () => {
        const target = boss({ lifeAt: () => 150, deathHistory: [{ At: 5, Dead: true }] });
        expect(bossInfoOf({ ...base, at: 9, target })).toMatchObject({ dead: true, life: 0, hpPct: 0 });
        expect(bossInfoOf({ ...base, at: 4, target })!.dead).toBe(false);
        const revived = boss({ deathHistory: [{ At: 5, Dead: true }, { At: 7, Dead: false }] });
        expect(bossInfoOf({ ...base, at: null, target: revived })!.dead).toBe(false);
    });
    it('is dead when the sampled life reached 0 (bosses get no death toggle)', () => {
        expect(bossInfoOf({ ...base, target: boss({ lifeAt: () => 0 }) })).toMatchObject({ dead: true, life: 0, hpPct: 0 });
        expect(bossInfoOf({ ...base, target: boss({ lifeAt: () => -5 }) })!.dead).toBe(true);
        // A damage-derived 0 is only an estimate, not a kill.
        expect(bossInfoOf({ ...base, dealt: 5000, target: boss() })!.dead).toBe(false);
    });
    it('is dead once the EntityDown time has passed (imported records carry no life samples)', () => {
        const target = boss({ downAt: 100 });
        expect(bossInfoOf({ ...base, at: null, target })).toMatchObject({ dead: true, life: 0, hpPct: 0 });
        expect(bossInfoOf({ ...base, at: 100, target })!.dead).toBe(true);
        expect(bossInfoOf({ ...base, at: 99, target })!.dead).toBe(false);
    });
    it('ignores an EntityDown followed by a later positive life sample', () => {
        const lifeHistory = [{ At: 90, Life: 5 }, { At: 110, Life: 400 }];
        const target = boss({ downAt: 100, lifeHistory, lifeAt: () => 400 });
        expect(bossInfoOf({ ...base, at: null, target })).toMatchObject({ dead: false, life: 400 });
        expect(bossInfoOf({ ...base, at: 120, target })!.dead).toBe(false);
        // Before the later sample arrives the down still counts.
        expect(bossInfoOf({ ...base, at: 105, target: boss({ downAt: 100, lifeHistory, lifeAt: () => 5 }) })!.dead).toBe(true);
    });
    it('has a null percent when only a sample exists', () => {
        const vm = bossInfoOf({ ...base, target: boss({ maxLife: 0, lifeAt: () => 40 }) })!;
        expect(vm).toMatchObject({ hpPct: null, life: 40, maxLife: 0 });
    });
});

describe('fightStats', () => {
    const rows = [
        { damages: [{ At: 100 }, { At: 110 }], totalDamage: 300 },
        { damages: [{ At: 105 }], totalDamage: 100 },
    ];
    it('matches the overlay model', () => {
        expect(fightStats(rows)).toEqual({ fightSec: 10, partyDps: 40 });
        const o = buildDpsOverlay({ rows: rows.map(r => ({ ...r, actor: { id: 'a' } })) as never, ownerId: '', nameOf: String, boss: null });
        expect(o.fightSec).toBe(10);
        expect(o.partyDps).toBe(40);
    });
    it('is empty without hits', () => {
        expect(fightStats([])).toEqual({ fightSec: null, partyDps: 0 });
    });
});

import { describe, it, expect } from 'vitest';
import {
    CC_MERGE_MAP, mergedIds, fightSpan, laneIds, laneSeries, coverageRows, buildDpsEntities,
    fightOwner, castTicks, runStartTicks, buildSelfHistory, playerSelfHistory,
} from './effectTimeline';
import type { EntityActor, EntityConditionState } from '@/eventActor';
import { eventIdBardsong, type eventBardsong } from '@/protocols';

const cond = (ccId: number) => ({ Id: '', At: 0, CCId: ccId, DisableAt: 0, AttackerId: '', Params: {} });
const st = (At: number, ...ids: number[]): EntityConditionState => ({ At, List: ids.map(cond) });

describe('mergedIds', () => {
    it('merges 913 into 912 and keeps unmapped ids alone', () => {
        expect(CC_MERGE_MAP[913]).toBe(912);
        expect(mergedIds(912)).toEqual([912, 913]);
        expect(mergedIds(494)).toEqual([494]);
    });
});

describe('fightSpan', () => {
    it('is null for no damage and min/max At otherwise', () => {
        expect(fightSpan([])).toBeNull();
        expect(fightSpan([{ damages: [] }])).toBeNull();
        expect(fightSpan([{ damages: [{ At: 5 }, { At: 9 }] }, { damages: [{ At: 3 }] }])).toEqual({ start: 3, end: 9 });
    });
});

describe('laneIds', () => {
    it('keeps tracked order, requires being seen (aliases count) and not chart-hidden', () => {
        const h = [st(0, 913), st(1, 494)];
        expect(laneIds([494, 912, 803], new Set(), h)).toEqual([494, 912]);
        expect(laneIds([494, 912], new Set([494]), h)).toEqual([912]);
    });
});

describe('laneSeries', () => {
    it('emits ms-relative points and pins a still-active last state to the right edge', () => {
        const h = [st(100), st(101, 494), st(103), st(104, 494)];
        expect(laneSeries(h, 494, 100, 110)).toEqual([[0, 0], [1000, 1], [3000, 0], [4000, 1], [10000, 1]]);
    });
    it('does not pad when the last state is off, and matches merged aliases', () => {
        expect(laneSeries([st(100, 913), st(102)], 912, 100, 110)).toEqual([[0, 1], [2000, 0]]);
        expect(laneSeries([], 1, 0, 5)).toEqual([]);
    });
    it('keeps one point per instant (the last state), so the axis tooltip lists each lane once', () => {
        const h = [st(100), st(101, 494), st(101), st(101, 494), st(102)];
        expect(laneSeries(h, 494, 100, 110)).toEqual([[0, 0], [1000, 1], [2000, 0]]);
    });
    it('keeps only the switches, dropping repeats of the same state', () => {
        const h = [st(100), st(101, 494), st(102, 494, 7), st(103, 494), st(104), st(105), st(106, 494)];
        expect(laneSeries(h, 494, 100, 107)).toEqual([[0, 0], [1000, 1], [4000, 0], [6000, 1], [7000, 1]]);
        expect(laneSeries([st(100), st(101, 494), st(101)], 494, 100, 110)).toEqual([[0, 0]]);
    });
});

describe('coverageRows', () => {
    it('uses the whole fight, thresholds 60/40 and flags chart visibility', () => {
        const h = [st(0), st(0, 1), st(6, 2), st(10)];
        const rows = coverageRows({ tracked: [1, 2, 3], chartHidden: new Set([3]), history: h, start: 0, end: 10 });
        expect(rows).toEqual([
            { ccId: 1, pct: 60, color: 'ok', onChart: true },
            { ccId: 2, pct: 40, color: 'warn', onChart: true },
            { ccId: 3, pct: 0, color: 'err', onChart: false },
        ]);
    });
    it('boundary just below 60 and 40', () => {
        const h = [st(0, 1), st(5.9), st(6.5, 2), st(10)];
        const rows = coverageRows({ tracked: [1, 2], chartHidden: new Set(), history: h, start: 0, end: 10 });
        expect(rows[0].color).toBe('warn');
        expect(rows[1].color).toBe('err');
    });
});

describe('buildDpsEntities', () => {
    const d = (At: number, Damage: number, TargetId = 't') => ({ At, Damage, TargetId }) as never;
    const actors: Record<string, { isPC: boolean }> = { a: { isPC: true }, b: { isPC: true }, npc: { isPC: false } };
    const grouped = { a: [d(1, 10), d(2, 20, 'x')], b: [d(1, 100)], npc: [d(1, 999)], gone: [d(1, 5)] };
    const base = { grouped, actorOf: (id: string) => actors[id], nameOf: (_: unknown, id: string) => id.toUpperCase(), targetId: '', minAt: null, maxAt: null };
    it('keeps PCs only, sorts by total desc', () => {
        expect(buildDpsEntities(base).map(e => e.name)).toEqual(['B', 'A']);
    });
    it('filters by target and time range and drops empty entities', () => {
        expect(buildDpsEntities({ ...base, targetId: 't' }).map(e => e.name)).toEqual(['B', 'A']);
        expect(buildDpsEntities({ ...base, targetId: 'x' }).map(e => e.name)).toEqual(['A']);
        expect(buildDpsEntities({ ...base, minAt: 2, maxAt: 3 }).map(e => e.name)).toEqual(['A']);
    });
});

describe('fightOwner', () => {
    it('reads the owner at fight start, first owner before any change', () => {
        const owners = [{ At: 50, Id: 'a' }, { At: 500, Id: 'b' }];
        expect(fightOwner(owners, 100)).toBe('a');
        expect(fightOwner(owners, 600)).toBe('b');
        expect(fightOwner([], 100)).toBe('');
    });
});

describe('castTicks', () => {
    const casts = [
        { CCId: 912, At: 105, AttackerId: 'x' },
        { CCId: 913, At: 110, AttackerId: 'x' },
        { CCId: 912, At: 50, AttackerId: 'x' },
        { CCId: 912, At: 300, AttackerId: 'x' },
        { CCId: 494, At: 120, AttackerId: 'x' },
    ];
    it('folds aliases, bounds to [start, end] and returns ms since origin sorted', () => {
        expect(castTicks(casts, 912, 100, 100, 200)).toEqual([5000, 10000]);
    });
});

describe('runStartTicks', () => {
    it('marks each off-to-on edge, including a leading on state', () => {
        const h = [st(100, 900206), st(120), st(150, 900206)];
        expect(runStartTicks(h, 900206, 100, 100, 200)).toEqual([0, 50000]);
    });
});

describe('buildSelfHistory 戰吼 source', () => {
    const actor = (history: EntityConditionState[]) => ({ conditionHistory: history }) as unknown as EntityActor;
    const notice: eventBardsong = { EventId: eventIdBardsong, At: 100, Id: '1', Performer: 'p', Song: 's', Bonuses: {}, IsEnd: false };
    const input = (self: EntityActor | undefined) => ({
        self, bardsongEvents: [notice], bardsongPulses: [], owners: [],
    });
    it('falls back to the synthetic owner track without real 900206', () => {
        const h = buildSelfHistory(input(actor([st(5, 516)])));
        expect(h.some(s => s.List.some(c => c.CCId === 900206))).toBe(true);
        expect(h.some(s => s.List.some(c => c.CCId === 516))).toBe(true);
    });
    it('uses the own real 900206 history and skips the synthetic one', () => {
        const h = buildSelfHistory(input(actor([st(120, 900206), st(140)])));
        expect(h.map(s => s.At)).toEqual([120, 140]);
    });
    it('is empty without a self actor', () => {
        expect(buildSelfHistory(input(undefined))).toEqual([]);
    });
});

describe('playerSelfHistory', () => {
    const actor = (history: EntityConditionState[]) => ({ conditionHistory: history }) as unknown as EntityActor;
    const notice: eventBardsong = { EventId: eventIdBardsong, At: 100, Id: '1', Performer: 'p', Song: 's', Bonuses: {}, IsEnd: false };
    const rest = { bardsongEvents: [notice], bardsongPulses: [], owners: [] };
    const has = (h: EntityConditionState[]) => h.some(s => s.List.some(c => c.CCId === 900206));
    it('gives the owner the synthetic 戰吼 fallback, others only their own history', () => {
        expect(has(playerSelfHistory(actor([st(5, 516)]), true, rest))).toBe(true);
        const other = playerSelfHistory(actor([st(5, 516)]), false, rest);
        expect(has(other)).toBe(false);
        expect(other).toEqual([st(5, 516)]);
        expect(playerSelfHistory(undefined, false, rest)).toEqual([]);
    });
});

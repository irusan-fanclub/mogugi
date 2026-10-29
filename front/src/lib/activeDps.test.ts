import { describe, expect, it } from 'vitest';
import fixtureRaw from '../../../internal/app/testdata/active_dps_fixture.json?raw';
import { activeDps, activeSeconds, deathSpans, excludedSpans, invincibleOf, invincibleWindows, togglesFromHistory, type CcToggle, type DeathToggle, type Span } from './activeDps';
import { ccName } from './util';
import type { EntityCondition, EntityConditionState } from '../eventActor';

interface Case {
    name: string;
    toggles: CcToggle[];
    endSec: number;
    fightStart: number;
    windows: Span[];
    hits: { At: number; Damage: number }[];
    deaths?: DeathToggle[];
    wantInvincible: Span[];
    wantDeaths?: Span[];
    wantActiveDps: number | null;
}

const fixture = JSON.parse(fixtureRaw) as { cases: Case[] };

describe('active dps fixture', () => {
    for (const c of fixture.cases) {
        it(c.name, () => {
            const inv = invincibleWindows(c.toggles, c.endSec);
            expect(inv).toEqual(c.wantInvincible);
            const deaths = deathSpans(c.deaths ?? [], c.endSec);
            expect(deaths).toEqual(c.wantDeaths ?? []);
            const got = activeDps(c.hits, c.windows, excludedSpans(c.fightStart, [...inv, ...deaths]));
            if (c.wantActiveDps === null) expect(got).toBeNull();
            else expect(Math.abs((got as number) - c.wantActiveDps)).toBeLessThan(1e-9);
        });
    }
});

describe('invincibleOf', () => {
    const cond = (CCId: number) => ({ CCId }) as EntityCondition;
    it('unions 91000, 494 and 277, an open span closing at the end', () => {
        const history: EntityConditionState[] = [
            { At: 10, List: [cond(277)] }, { At: 20, List: [cond(277), cond(91000)] },
            { At: 50, List: [cond(91000)] }, { At: 57, List: [] },
            { At: 70, List: [cond(494)] }, { At: 71, List: [] },
            { At: 100, List: [cond(91000)] },
        ];
        expect(invincibleOf(history, 120)).toEqual([[10, 57], [100, 120]]);
        expect(invincibleOf(undefined, 120)).toEqual([]);
    });
});

describe('togglesFromHistory', () => {
    it('diffs condition lists into on/off toggles', () => {
        const cond = (CCId: number) => ({ CCId }) as EntityCondition;
        const history: EntityConditionState[] = [
            { At: 10, List: [cond(494)] },
            { At: 12, List: [cond(494), cond(277)] },
            { At: 20, List: [] },
        ];
        const key = (t: CcToggle) => `${t.At}-${t.CCId}-${t.on}`;
        const got = togglesFromHistory(history, [494, 277]).map(key).sort();
        const want = [
            { At: 10, CCId: 494, on: true }, { At: 12, CCId: 277, on: true },
            { At: 20, CCId: 494, on: false }, { At: 20, CCId: 277, on: false },
        ].map(key).sort();
        expect(got).toEqual(want);
    });
});

describe('ccName', () => {
    it('names CC 277', () => {
        expect(ccName({}, 277)).toBe('Boss 無敵');
    });
});

describe('activeSeconds', () => {
    it('is window time minus excluded overlap, and matches the activeDps denominator', () => {
        const hits = [{ At: 2, Damage: 100 }, { At: 8, Damage: 100 }];
        expect(activeSeconds([[0, 10]], [[0, 4]])).toBe(6);
        expect(activeDps(hits, [[0, 10]], [[0, 4]])).toBeCloseTo(100 / 6);
        expect(activeSeconds([[0, 4]], [[0, 4]])).toBe(0);
        expect(activeSeconds([], [])).toBe(0);
    });
});

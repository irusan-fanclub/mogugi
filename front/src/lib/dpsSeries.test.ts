import { describe, it, expect } from 'vitest';
import { rollingDamageSeries } from './dpsSeries';

const at = (rel: number, dmg: number) => ({ At: 1000 + rel, Damage: dmg });

// Centres of the points that include the big hit. A far-away second hit keeps
// the loop running past the burst so the tail is not truncated by maxRel.
const burstSpan = (windowSec: number) =>
    rollingDamageSeries([at(30, 100), at(90, 1)], 1000, windowSec)
        .filter(p => p[1] >= 100)
        .map(p => p[0] / 1000);

describe('rollingDamageSeries', () => {
    it('returns nothing for no damage', () => {
        expect(rollingDamageSeries([], 1000, 15)).toEqual([]);
    });

    // The reported bug: summing [t, t+w) but plotting at t put a burst's peak a
    // whole window early, so the DPS peak sat outside the debuff lane that
    // caused it. A centred window straddles the hit instead of trailing it.
    it('straddles the burst rather than leading it', () => {
        const span = burstSpan(10);
        expect(span[0]).toBe(26);
        expect(span[span.length - 1]).toBe(35);
    });

    // Same hit, wider window: the span grows on BOTH sides. Under the old
    // left-edge plotting it would only have grown backwards.
    it('widens symmetrically as the window grows', () => {
        const span = burstSpan(20);
        expect(span[0]).toBe(21);
        expect(span[span.length - 1]).toBe(40);
    });

    it('sums every hit inside the window', () => {
        const series = rollingDamageSeries([at(10, 5), at(12, 7), at(14, 9)], 1000, 15);
        expect(series.find(p => p[0] === 12_000)?.[1]).toBe(21);
    });

    it('reads damage in arrival order, not sorted order', () => {
        const shuffled = rollingDamageSeries([at(14, 9), at(10, 5), at(12, 7)], 1000, 15);
        const ordered = rollingDamageSeries([at(10, 5), at(12, 7), at(14, 9)], 1000, 15);
        expect(shuffled).toEqual(ordered);
    });

    it('starts at the origin and runs to the last hit', () => {
        const series = rollingDamageSeries([at(0, 1), at(4, 1)], 1000, 2);
        expect(series[0][0]).toBe(0);
        expect(series[series.length - 1][0]).toBe(4000);
    });
});

describe('rollingDamageSeries stride', () => {
    // The chart thins long fights so hover stays responsive; the shape must
    // survive it, only the sampling density changes.
    it('emits one point per stride, still starting at the origin', () => {
        const hits = Array.from({ length: 41 }, (_, i) => at(i, 1));
        const dense = rollingDamageSeries(hits, 1000, 10);
        const thin = rollingDamageSeries(hits, 1000, 10, 4);

        expect(dense).toHaveLength(41);
        expect(thin.map(p => p[0] / 1000)).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40]);
    });

    it('reads the same value at a point both samplings share', () => {
        const hits = [at(10, 5), at(12, 7), at(14, 9)];
        const dense = rollingDamageSeries(hits, 1000, 15);
        const thin = rollingDamageSeries(hits, 1000, 15, 2);
        const atTwelve = (s: [number, number][]) => s.find(p => p[0] === 12_000)?.[1];

        expect(atTwelve(thin)).toBe(atTwelve(dense));
    });
});

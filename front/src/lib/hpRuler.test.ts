import { describe, it, expect } from 'vitest';
import { hpCrossings as crossings, hpCurve, hpPctAt as pctAt, placeRulerLabels } from './hpRuler';

const linear = () => ({
    lifeHistory: [], maxLife: 1000, start: 0, end: 100,
    damages: Array.from({ length: 100 }, (_, i) => ({ At: i + 1, Damage: 10 })),
});

type In = Parameters<typeof hpCurve>[0];
const hpCrossings = (i: In) => crossings(hpCurve(i));
const hpPctAt = (i: In, at: number) => pctAt(hpCurve(i), at);

describe('hpCrossings', () => {
    it('linear damage over 100s gives 19 marks at 5s steps', () => {
        const m = hpCrossings(linear());
        expect(m).toHaveLength(19);
        expect(m[0]).toEqual({ pct: 95, at: 5 });
        expect(m[18].pct).toBe(5);
        expect(m[18].at).toBeCloseTo(95);
    });

    it('ignores re-crossing after heal', () => {
        const m = hpCrossings({
            lifeHistory: [{ At: 0, Life: 100 }, { At: 10, Life: 70 }, { At: 20, Life: 80 }, { At: 30, Life: 60 }],
            damages: [], maxLife: 100, start: 0, end: 30,
        });
        expect(m.filter(x => x.pct === 75)).toHaveLength(1);
        expect(m.filter(x => x.pct === 70)).toHaveLength(1);
        expect(m.find(x => x.pct === 75)!.at).toBeCloseTo(8.333, 2);
    });

    it('no life data gives no marks', () => {
        expect(hpCrossings({ ...linear(), maxLife: 0 })).toEqual([]);
        expect(hpPctAt({ ...linear(), maxLife: 0 }, 10)).toBeNull();
    });
});

describe('hpCrossings starting below 95%', () => {
    const samples = (a: number, b: number) => ({
        lifeHistory: [{ At: 0, Life: a }, { At: 100, Life: b }], damages: [], maxLife: 100, start: 0, end: 100,
    });
    it('reports every step below a mid-fight start', () => {
        const m = hpCrossings(samples(80, 40));
        expect(m.map(x => x.pct)).toEqual([75, 70, 65, 60, 55, 50, 45, 40]);
    });
    it('does not report the starting step itself', () => {
        expect(hpCrossings(samples(80, 60)).map(x => x.pct)).not.toContain(80);
    });
});

describe('hpPctAt', () => {
    it('follows maxLife minus dealt, interpolating in time', () => {
        expect(hpPctAt(linear(), 50)).toBeCloseTo(50);
        expect(hpPctAt(linear(), 0)).toBe(100);
        expect(hpPctAt(linear(), 500)).toBeCloseTo(0);
    });
});

describe('placeRulerLabels', () => {
    it('prefers multiples of 25 then 10 and drops labels closer than the gap', () => {
        const s = placeRulerLabels([{ pct: 75, x: 0 }, { pct: 70, x: 20 }, { pct: 50, x: 40 }, { pct: 65, x: 60 }]);
        expect([...s].sort()).toEqual([50, 75]);
    });
    it('keeps labels that are far enough apart', () => {
        const s = placeRulerLabels([{ pct: 75, x: 0 }, { pct: 70, x: 35 }]);
        expect([...s].sort()).toEqual([70, 75]);
    });
});

describe('hpCurve downAt', () => {
    it('appends [downAt, 0] so the ruler reaches the remaining marks', () => {
        const base = { lifeHistory: [], maxLife: 1000, start: 0, end: 100, damages: [{ At: 10, Damage: 900 }] };
        expect(hpCrossings(base).at(-1)!.pct).toBe(10);
        const m = hpCrossings({ ...base, downAt: 50 });
        expect(m.at(-1)).toEqual({ pct: 5, at: 50 - 40 * 5 / 10 });
        expect(hpCurve({ ...base, downAt: 50 }).at(-1)).toEqual([50, 0]);
    });

    it('ignores a downAt outside the fight', () => {
        const base = { lifeHistory: [], maxLife: 1000, start: 0, end: 100, damages: [{ At: 10, Damage: 900 }] };
        expect(hpCurve({ ...base, downAt: 500 })).toEqual(hpCurve(base));
        expect(hpCurve({ ...base, downAt: null })).toEqual(hpCurve(base));
    });
});

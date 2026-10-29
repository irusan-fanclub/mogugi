import { describe, it, expect, vi } from 'vitest';
import * as et from './effectTimeline';
import { ccActiveAt, ccSeenIn, skillCcCoverage } from './skillCcCoverage';

vi.mock('./effectTimeline', async importOriginal => {
    const actual = await importOriginal<typeof import('./effectTimeline')>();
    return { ...actual, mergedIds: vi.fn(actual.mergedIds) };
});

const st = (At: number, ...ids: number[]) => ({ At, List: ids.map(CCId => ({ CCId })) } as never);
const hit = (At: number) => ({ At } as never);

describe('ccActiveAt', () => {
    it('same-second enable covers', () => {
        expect(ccActiveAt([st(10, 5)], 5, 10)).toBe(true);
    });
    it('hit before the first state is not covered', () => {
        expect(ccActiveAt([st(10, 5)], 5, 9)).toBe(false);
    });
    it('uses the last state at or before the hit', () => {
        const h = [st(1, 5), st(4), st(8, 5)];
        expect([ccActiveAt(h, 5, 3), ccActiveAt(h, 5, 5), ccActiveAt(h, 5, 9)]).toEqual([true, false, true]);
    });
    it('alias counts', () => {
        expect(ccActiveAt([st(0, 913)], 912, 5)).toBe(true);
    });
    it('empty history', () => {
        expect(ccActiveAt([], 5, 5)).toBe(false);
    });
});

describe('ccSeenIn', () => {
    it('canonicalises aliases and respects the range', () => {
        const h = [st(0, 7), st(5, 913), st(20, 8)];
        expect(ccSeenIn(h, 3, 10)).toEqual(new Set([7, 912]));
        expect(ccSeenIn(h, 0, 20)).toEqual(new Set([7, 912, 8]));
    });
});

describe('skillCcCoverage', () => {
    it('per-hit target', () => {
        const a = [st(0, 5)], b = [st(0)];
        const h1 = hit(1), h2 = hit(2);
        const r = skillCcCoverage({ hits: [h1, h2], ccIds: [5], historyOf: h => (h === h1 ? a : b) });
        expect(r).toEqual([{ ccId: 5, covered: 1, total: 2 }]);
    });
    it('one entry per ccId in order', () => {
        const hist = [st(0, 5)];
        const r = skillCcCoverage({ hits: [hit(1), hit(2), hit(3)], ccIds: [9, 5], historyOf: () => hist });
        expect(r).toEqual([{ ccId: 9, covered: 0, total: 3 }, { ccId: 5, covered: 3, total: 3 }]);
    });
});

describe('skillCcCoverage perf shape and aliases', () => {
    it('resolves alias ids once per CC, not per hit', () => {
        const spy = vi.mocked(et.mergedIds);
        spy.mockClear();
        const hist = [st(0, 5)];
        const hits = Array.from({ length: 100 }, (_, i) => hit(i));
        skillCcCoverage({ hits, ccIds: [5, 6], historyOf: () => hist });
        expect(spy.mock.calls.length).toBeLessThanOrEqual(2);
    });
    it('alias id in the list counts hits of its canonical group', () => {
        const r = skillCcCoverage({ hits: [hit(1)], ccIds: [913], historyOf: () => [st(0, 912)] });
        expect(r).toEqual([{ ccId: 913, covered: 1, total: 1 }]);
        expect(ccActiveAt([st(0, 912)], 913, 1)).toBe(true);
    });
});

describe('ccSeenIn window start', () => {
    it('includes the state in force at the window start', () => {
        expect(ccSeenIn([st(0, 7)], 5, 10)).toEqual(new Set([7]));
    });
    it('does not include a state that ended before the window', () => {
        expect(ccSeenIn([st(0, 7), st(3)], 5, 10)).toEqual(new Set());
    });
});

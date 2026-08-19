import { describe, it, expect } from 'vitest';
import { computeCCCoverage, computeCCCoverageBy, clipToWindow } from './conditionCoverage';

// history entries are [At, list of CCIds]; helper keeps the tests readable
// (mirrors musicBuff.test.ts's own `h`).
const h = (at: number, ccIds: number[] = [], attackerId = 'a') => ({
    At: at,
    List: ccIds.map(CCId => ({ CCId, AttackerId: attackerId, Params: {} })),
} as never);

describe('computeCCCoverage', () => {
    it('uses the window length as the denominator when the window starts before history', () => {
        // Only data point is at t=5; the caller's window is [0, 10].
        const r = computeCCCoverage([h(5, [1])], [1], 0, 10);
        expect(r.totalSec).toBe(10);
        expect(r.onSec).toBe(5); // on from t=5 (its first appearance) to windowEnd
    });

    it('the reported bug: history starts before the window — denominator must stay the window length', () => {
        // history[0].At (-100) is far earlier than the window start (0). A
        // buggy denominator (endAt - history[0].At) would give 110, not 10.
        const r = computeCCCoverage([h(-100, [1]), h(5, [1])], [1], 0, 10);
        expect(r.totalSec).toBe(10);
        expect(r.onSec).toBe(10); // on the whole window: it was already on at t=0
    });

    it('a CC already on before the window start counts as on from the window start', () => {
        const r = computeCCCoverage([h(-50, [1])], [1], 0, 10);
        expect(r).toEqual({ totalSec: 10, onSec: 10 });
    });

    it('a CC still on at the window end has its segment clipped to windowEnd', () => {
        const r = computeCCCoverage([h(0, []), h(8, [1])], [1], 0, 10);
        expect(r.totalSec).toBe(10);
        expect(r.onSec).toBe(2); // 8..10, not extended past the window
    });

    it('reports zero on-time (not zero total) for an empty history inside a real window', () => {
        const r = computeCCCoverage([], [1], 0, 10);
        expect(r).toEqual({ totalSec: 10, onSec: 0 });
    });

    it('clamps a degenerate (end <= start) window to zero total', () => {
        const r = computeCCCoverage([h(0, [1])], [1], 10, 5);
        expect(r).toEqual({ totalSec: 0, onSec: 0 });
    });
});

describe('computeCCCoverageBy', () => {
    it('filters by an arbitrary predicate (e.g. attacker) and still clips to the window', () => {
        const history = [
            h(-10, [1], 'p1'),
            h(3, [1], 'p2'),
        ];
        const r = computeCCCoverageBy(history, c => c.AttackerId === 'p1', 0, 10);
        // p1's condition was on before the window and gets overwritten by p2's
        // at t=3, so p1's on-time within the window is only [0, 3).
        expect(r).toEqual({ totalSec: 10, onSec: 3 });
    });
});

describe('clipToWindow', () => {
    it('seeds the window start with the state already in force there', () => {
        const windowed = clipToWindow([h(-10, [1])], 0, 10);
        expect(windowed[0]).toMatchObject({ At: 0, List: [{ CCId: 1, AttackerId: 'a', Params: {} }] });
    });

    it('drops entries after windowEnd', () => {
        const windowed = clipToWindow([h(0, []), h(5, [1]), h(20, [2])], 0, 10);
        expect(windowed.map(s => s.At)).toEqual([0, 5]);
    });
});

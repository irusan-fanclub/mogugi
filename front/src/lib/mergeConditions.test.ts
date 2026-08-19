import { describe, it, expect } from 'vitest';
import { mergeConditionHistories } from './mergeConditions';
import type { EntityCondition, EntityConditionState } from '@/eventActor';

const cond = (ccId: number): EntityCondition =>
    ({ Id: '', At: 0, CCId: ccId, DisableAt: 0, AttackerId: '', Params: {} });

const st = (at: number, ...ccIds: number[]): EntityConditionState =>
    ({ At: at, List: ccIds.map(cond) });

const ccIdsAt = (h: EntityConditionState[], at: number) =>
    h.find(s => s.At === at)?.List.map(c => c.CCId).sort((a, b) => a - b);

describe('mergeConditionHistories', () => {
    it('reads a CC as present when any source has it', () => {
        const merged = mergeConditionHistories([
            { history: [st(0), st(10, 1)] },
            { history: [st(0), st(5, 2)] },
        ]);
        expect(ccIdsAt(merged, 5)).toEqual([2]);
        expect(ccIdsAt(merged, 10)).toEqual([1, 2]);
    });

    it('hands a lone unfiltered source back as it is', () => {
        const history = [st(0, 1), st(5, 1), st(10, 1)];
        expect(mergeConditionHistories([{ history }])).toEqual(history);
    });

    it('collapses states that carry the same set', () => {
        const merged = mergeConditionHistories([
            { history: [st(0, 1), st(5, 1), st(10, 1)] },
            { history: [st(0, 2)] },
        ]);
        expect(merged.map(s => s.At)).toEqual([0]);
    });

    it('takes only the named CCs from a filtered source', () => {
        const merged = mergeConditionHistories([
            { history: [st(0, 99)] },
            { history: [st(0, 1), st(5, 1, 2)], ccIds: [2] },
        ]);
        expect(ccIdsAt(merged, 5)).toEqual([2, 99]);
    });

    // The performance bug this guards: a filtered source used to drag every one
    // of its timestamps into the union, so a party member with thousands of
    // unrelated states cost thousands of merge steps to contribute one CC.
    it('ignores timestamps a filtered source cannot contribute to', () => {
        const noise: EntityConditionState[] = [];
        for (let i = 0; i < 500; i++) noise.push(st(i, 90 + (i % 5)));
        noise.push(st(500, 90, 7));

        const merged = mergeConditionHistories([
            { history: [st(0), st(600, 1)] },
            { history: noise, ccIds: [7] },
        ]);

        // Only where something is actually on: 500 when 7 arrives, 600 for the
        // other source. The leading all-empty state collapses into the empty
        // set the merge starts from.
        expect(merged.map(s => s.At)).toEqual([500, 600]);
    });

    it('keeps a filtered source that never carries a named CC out of the way', () => {
        const merged = mergeConditionHistories([
            { history: [st(0, 1)] },
            { history: [st(3, 42), st(4, 43)], ccIds: [7] },
        ]);
        expect(merged.map(s => s.At)).toEqual([0]);
    });

    it('returns nothing for no usable source', () => {
        expect(mergeConditionHistories([{ history: [] }])).toEqual([]);
    });
});

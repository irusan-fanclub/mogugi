import { describe, it, expect } from 'vitest';
import type { EntityCondition, EntityConditionState } from '@/eventActor';
import { boundHistory, ccOptions, compressSteps, series, statsWindow } from './conditionTimeline';

const c = (CCId: number, AttackerId = 'a'): EntityCondition => ({ Id: '', At: 0, CCId, DisableAt: 0, AttackerId, Params: {} });
const st = (At: number, ...List: EntityCondition[]): EntityConditionState => ({ At, List });
const resolve = (id: string) => ({ id, name: id === '' ? 'unknown' : `n-${id}` });

describe('ccOptions', () => {
    it('sorts ids and drops hidden ones', () => {
        const h = [st(1, c(9), c(3)), st(2, c(5))];
        expect(ccOptions(h)).toEqual([3, 5, 9]);
    });
});

describe('boundHistory', () => {
    it('filters inclusively only when both bounds exist', () => {
        const h = [st(1), st(5), st(9)];
        expect(boundHistory(h, 5, 9).map(s => s.At)).toEqual([5, 9]);
        expect(boundHistory(h, null, 9)).toBe(h);
    });
});

describe('statsWindow', () => {
    const h = [st(10), st(50)];
    it('falls back to the history span', () => expect(statsWindow(h, null, null, null, null)).toEqual({ start: 10, end: 50 }));
    it('intersects bounds with the zoom range', () => {
        expect(statsWindow(h, 20, 40, 30, 60)).toEqual({ start: 30, end: 40 });
        expect(statsWindow(h, null, null, 30, 60)).toEqual({ start: 30, end: 60 });
    });
    it('is null for an empty history without bounds', () => expect(statsWindow([], null, null, null, null)).toBeNull());
});

describe('series', () => {
    it('one series per attacker with 0/1 step points in ms', () => {
        const h = [st(1, c(7, 'a')), st(2, c(7, 'a'), c(7, 'b')), st(3)];
        expect(series(h, 7, resolve)).toEqual([
            { name: 'n-a', points: [[1000, 1], [2000, 1], [3000, 0]] },
            { name: 'n-b', points: [[1000, 0], [2000, 1], [3000, 0]] },
        ]);
    });
    it('an empty-AttackerId-only CC keeps the resolved name by default (old chart)', () => {
        const h = [st(1, c(7, '')), st(2)];
        expect(series(h, 7, resolve)).toEqual([{ name: 'unknown', points: [[1000, 1], [2000, 0]] }]);
    });
    it('unknownAsOn turns an empty-AttackerId-only CC into a single ON series', () => {
        const h = [st(1, c(7, '')), st(2)];
        expect(series(h, 7, resolve, { unknownAsOn: true })).toEqual([{ name: 'ON', points: [[1000, 1], [2000, 0]] }]);
    });
    it('a CC absent from the history also falls back to ON; empty history has no series', () => {
        expect(series([st(1, c(1))], 7, resolve)[0].name).toBe('ON');
        expect(series([], 7, resolve)).toEqual([]);
    });
});

describe('compressSteps', () => {
    it('keeps first, changes and last', () => {
        expect(compressSteps([[1, 0], [2, 0], [3, 1], [4, 1], [5, 1], [6, 0], [7, 0]])).toEqual([[1, 0], [3, 1], [6, 0], [7, 0]]);
    });
});

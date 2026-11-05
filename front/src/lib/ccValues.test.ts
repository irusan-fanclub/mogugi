import { describe, it, expect } from 'vitest';
import type { EntityConditionState } from '@/eventActor';
import { ccValueSummaries } from './ccValues';

const cc = (CCId: number, Params: Record<string, string>) =>
    ({ Id: 'x', At: 0, CCId, DisableAt: 0, AttackerId: '', Params });
const st = (At: number, ...List: ReturnType<typeof cc>[]): EntityConditionState => ({ At, List });

describe('ccValueSummaries', () => {
    // 1164 refreshed: 103 from 24201, then a weaker 27205 reading, then off; a stronger one after the range.
    const history = [
        st(10, cc(1164, { MCDDDV: '80', MCDDPV: '20', MCDCASI: '27205' })),
        st(20, cc(1164, { MCDDDV: '103', MCDDPV: '28', MCDCASI: '24201' })),
        st(30, cc(1164, { MCDDDV: '90', MCDDPV: '30', MCDCASI: '27205', SBT: '5' })),
        st(40),
        st(60, cc(1164, { MCDDDV: '200', MCDDPV: '50', MCDCASI: '1' })),
    ];

    it('keeps the highest value per key', () => {
        const s = ccValueSummaries(history, 0, 50).get(1164)!;
        expect(s.values.MCDDDV).toBe('103');
        expect(s.values.MCDDPV).toBe('30');
        expect(s.coveragePct).toBeCloseTo(60);
    });

    it('ignores readings outside the range and seeds the one in force at the start', () => {
        const s = ccValueSummaries(history, 25, 35).get(1164)!;
        expect(s.values.MCDDDV).toBe('103');
        expect(s.coveragePct).toBeCloseTo(100);
        expect(ccValueSummaries(history, 41, 55).has(1164)).toBe(false);
    });

    it('compares reductions by amount and keeps non-numeric values', () => {
        const s = ccValueSummaries([st(0, cc(9, { A: '-5', N: 'x' })), st(5, cc(9, { A: '-60', N: 'y' }))], 0, 10).get(9)!;
        expect(s.values.A).toBe('-60');
        expect(s.values.N).toBe('y');
    });

    it('reads true/false as 1/0 so a true reading wins', () => {
        const h = [st(0, cc(1138, { MCCSSE: 'false' })), st(2, cc(1138, { MCCSSE: 'true' })), st(4, cc(1138, { MCCSSE: 'false' }))];
        expect(ccValueSummaries(h, 0, 10).get(1138)!.values.MCCSSE).toBe('true');
        expect(ccValueSummaries(h.slice(0, 1), 0, 10).get(1138)!.values.MCCSSE).toBe('false');
    });

    it('folds merged CC aliases into the canonical id', () => {
        const s = ccValueSummaries([st(0, cc(913, { X: '1' })), st(4, cc(912, { X: '2' })), st(8)], 0, 10);
        expect(s.has(913)).toBe(false);
        expect(s.get(912)!.values.X).toBe('2');
        expect(s.get(912)!.coveragePct).toBeCloseTo(80);
    });

    it('is empty for an empty range', () => {
        expect(ccValueSummaries(history, 30, 30).size).toBe(0);
    });
});

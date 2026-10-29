import { describe, it, expect } from 'vitest';
import { isCast } from './castDetect';
import type { EntityCondition } from '@/eventActor';

function cc(DisableAt: number, SBT: string | null = '1'): EntityCondition {
    return { Id: '1', At: 0, CCId: 1116, DisableAt, AttackerId: '', Params: SBT === null ? {} : { SBT } };
}

describe('isCast', () => {
    it('is a cast when nothing was on before', () => {
        expect(isCast(undefined, cc(100))).toBe(true);
    });
    it('is a cast when the server end time moves by 5s', () => {
        expect(isCast(cc(100, '63928054695000'), cc(100, '63928054700000'))).toBe(true);
    });
    it('a sub-second server end-time adjustment is not a cast', () => {
        expect(isCast(cc(100, '63928054695000'), cc(100, '63928054695846'))).toBe(false);
    });
    it('only a param or DisableAt move with the same SBT is not a cast', () => {
        expect(isCast(cc(100, '1'), cc(103, '1'))).toBe(false);
    });
    it('without SBT uses a 1s DisableAt tolerance', () => {
        expect(isCast(cc(100, null), cc(100.9, null))).toBe(false);
        expect(isCast(cc(100, null), cc(101.5, null))).toBe(true);
    });
});

import { describe, it, expect } from 'vitest';
import { plusCandidates } from './skillCcCandidates';

describe('plusCandidates', () => {
    it('excludes tracked ids and splits boss/self ascending', () => {
        const r = plusCandidates({
            targetSeen: new Set([9, 3, 1]), selfSeen: new Set([8, 5, 2, 7]),
            boss: [1], common: [5], arcana: [7],
        });
        expect(r).toEqual({ boss: [3, 9], self: [2, 8] });
    });
    it('handles unknown arcana', () => {
        const r = plusCandidates({ targetSeen: new Set(), selfSeen: new Set([4]), boss: [], common: [], arcana: null });
        expect(r.self).toEqual([4]);
    });
});

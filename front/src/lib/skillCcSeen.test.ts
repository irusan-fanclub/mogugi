import { describe, it, expect } from 'vitest';
import { buildSkillCcSeen } from './skillCcSeen';

const hist = (...ids: number[]) => [{ List: ids.map(CCId => ({ CCId })) }];
const pc = (arc: number | null, ...ids: number[]) => ({ isPC: true, conditionHistory: hist(...ids), arc });

describe('buildSkillCcSeen', () => {
    it('splits target, player and per-arcana ids with player counts', () => {
        const seen = buildSkillCcSeen([
            { isPC: false, conditionHistory: hist(1, 2), arc: null },
            pc(1, 323, 516), pc(1, 323), pc(7, 1122), pc(null, 9),
        ], a => a.arc);
        expect([...seen.boss]).toEqual([1, 2]);
        expect([...seen.common].sort((a, b) => a - b)).toEqual([9, 323, 516, 1122]);
        expect(seen.arcana[1].get(323)).toBe(2);
        expect(seen.arcana[1].get(516)).toBe(1);
        expect(seen.arcana[7].get(1122)).toBe(1);
        expect(Object.keys(seen.arcana)).toEqual(['1', '7']);
    });
});

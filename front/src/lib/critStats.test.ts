import { describe, it, expect } from 'vitest';
import { computeCritStats } from './critStats';

const d = (Damage: number, IsCritical: boolean) => ({ Damage, IsCritical } as never);
const delayed = (Damage: number, IsCritical: boolean, SkillId: number) =>
    ({ Damage, IsCritical, SkillId, IsDelayed: true } as never);

describe('computeCritStats', () => {
    it('splits the averages and reports the rate', () => {
        expect(computeCritStats([d(100, true), d(300, true), d(50, false), d(50, false)]))
            .toEqual({ rate: 0.5, critAvg: 200, normalAvg: 50, critCount: 2, normalCount: 2,
                critMin: 100, critMax: 300, normalMin: 50, normalMax: 50 });
    });

    it('reports zero averages for an empty input rather than NaN', () => {
        expect(computeCritStats([]))
            .toEqual({ rate: 0, critAvg: 0, normalAvg: 0, critCount: 0, normalCount: 0,
                critMin: 0, critMax: 0, normalMin: 0, normalMax: 0 });
    });

    it('does not divide by zero when one side is missing', () => {
        const s = computeCritStats([d(100, true)]);
        expect(s.rate).toBe(1);
        expect(s.normalAvg).toBe(0);
    });

    // The row's count/min/max already drop delayed hits; the crit numbers
    // beside them have to drop the same ones or the denominators disagree.
    it('excludes a delayed hit, matching the count shown beside it', () => {
        expect(computeCritStats([d(100, true), d(50, false), delayed(9999, true, 59167)]))
            .toEqual({ rate: 0.5, critAvg: 100, normalAvg: 50, critCount: 1, normalCount: 1,
                critMin: 100, critMax: 100, normalMin: 50, normalMax: 50 });
    });

    it('counts a delayed hit on a needCountSkill skill', () => {
        expect(computeCritStats([delayed(100, true, 58101), delayed(300, true, 58101)]))
            .toEqual({ rate: 1, critAvg: 200, normalAvg: 0, critCount: 2, normalCount: 0,
                critMin: 100, critMax: 300, normalMin: 0, normalMax: 0 });
    });

    it('reports the range of each side separately', () => {
        const s = computeCritStats([
            d(100, true), d(300, true), d(200, true),
            d(50, false), d(90, false),
        ]);
        expect(s).toMatchObject({ critMin: 100, critMax: 300, normalMin: 50, normalMax: 90 });
    });

    // A side with no hits reports zeroes, not the other side's numbers.
    it('leaves an empty side at zero', () => {
        const s = computeCritStats([d(100, true)]);
        expect(s).toMatchObject({ critMin: 100, critMax: 100, normalMin: 0, normalMax: 0 });
        expect(computeCritStats([])).toMatchObject({
            critMin: 0, critMax: 0, normalMin: 0, normalMax: 0,
        });
    });
});

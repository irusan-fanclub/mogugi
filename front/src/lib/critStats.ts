import type { EntityDamage } from '@/eventActor';
import { countsTowardStats } from '@/actionCollector';

export type CritStats = {
    rate: number; critAvg: number; normalAvg: number;
    critCount: number; normalCount: number;
    critMin: number; critMax: number;
    normalMin: number; normalMax: number;
};

/** Averages are reported separately because a blended average hides how
 *  much of the output actually comes from criticals. Delayed hits are skipped
 *  by the same rule the row's count/min/max use, so the numbers agree. */
export function computeCritStats(damages: EntityDamage[]): CritStats {
    let critCount = 0, critSum = 0, critMin = 0, critMax = 0;
    let normalCount = 0, normalSum = 0, normalMin = 0, normalMax = 0;
    for (const v of damages) {
        if (!countsTowardStats(v)) continue;
        if (v.IsCritical) {
            if (critCount === 0 || v.Damage < critMin) critMin = v.Damage;
            if (critCount === 0 || v.Damage > critMax) critMax = v.Damage;
            critCount++; critSum += v.Damage;
        }
        else {
            if (normalCount === 0 || v.Damage < normalMin) normalMin = v.Damage;
            if (normalCount === 0 || v.Damage > normalMax) normalMax = v.Damage;
            normalCount++; normalSum += v.Damage;
        }
    }
    const total = critCount + normalCount;
    return {
        rate: total ? critCount / total : 0,
        critAvg: critCount ? critSum / critCount : 0,
        normalAvg: normalCount ? normalSum / normalCount : 0,
        critCount, normalCount,
        critMin, critMax, normalMin, normalMax,
    };
}

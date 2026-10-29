import type { DualGroupedDamageCollector } from '@/actionCollector';
import type { EntityDamage } from '@/eventActor';
import { filterByTimeRange } from '@/lib/timeRangeFilter';
import { timeRangeMax, timeRangeMin } from '@/store';

export interface Bucket {
    damages: EntityDamage[];
    /** Collector-maintained sum: any in-place change (reattribute, clear+refill) shifts it. */
    sum: number;
}

/** One player's hits, narrowed to the target when one is given. */
export function playerBucket(dc: DualGroupedDamageCollector, tid: string): Bucket {
    return tid
        ? { damages: dc.groupedDamages[tid] ?? [], sum: dc.groupedTotalDamages[tid] ?? 0 }
        : { damages: dc.damages, sum: dc.totalDamage };
}

/** One skill's hits of a player, narrowed to the target when one is given. */
export function skillBucket(dc: DualGroupedDamageCollector, tid: string, skillId: number): Bucket {
    return tid
        ? { damages: dc.dualGroupedDamages[tid]?.[skillId] ?? [], sum: dc.dualGroupedTotalDamages[tid]?.[skillId] ?? 0 }
        : { damages: dc.grouped2Damages[skillId] ?? [], sum: dc.grouped2TotalDamages[skillId] ?? 0 };
}

/** The main window's time range as a change-key fragment ('' when unset). */
export const rangeKey = () => (timeRangeMin.value !== null && timeRangeMax.value !== null
    ? `${timeRangeMin.value}:${timeRangeMax.value}` : '');

export const inTimeRange = (damages: EntityDamage[]) => filterByTimeRange(damages, timeRangeMin.value, timeRangeMax.value);

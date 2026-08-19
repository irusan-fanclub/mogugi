import type { EntityDamage } from '@/eventActor';
import { countsTowardStats } from '@/actionCollector';

/** Bin damages into fixed-size time windows. Returns a map of bin-start → total damage. */
export function bucketDamages(damages: EntityDamage[], binSize: number): Map<number, number> {
    const bins = new Map<number, number>();
    for (const d of damages) {
        const bt = d.At - (d.At % binSize);
        bins.set(bt, (bins.get(bt) || 0) + d.Damage);
    }
    return bins;
}

/** Bin damages into fixed-size time windows. Returns a map of bin-start → hit count. */
export function bucketCounts(damages: EntityDamage[], binSize: number): Map<number, number> {
    const bins = new Map<number, number>();
    for (const d of damages) {
        const bt = d.At - (d.At % binSize);
        bins.set(bt, (bins.get(bt) || 0) + 1);
    }
    return bins;
}

export function filterByTimeRange(
    damages: EntityDamage[],
    minAt: number | null,
    maxAt: number | null,
): EntityDamage[] {
    if (minAt === null || maxAt === null) return damages;
    return damages.filter(d => d.At >= minAt && d.At <= maxAt);
}

export type GroupedStats = {
    totalDamage: number;
    groupedTotalDamages: Record<string, number>;
    groupedDamages: Record<string, EntityDamage[]>;
    groupedCount: Record<string, number>;
    groupedCriticalCount: Record<string, number>;
    groupedMinDamages: Record<string, number>;
    groupedMaxDamages: Record<string, number>;
};

export function computeGroupedStats(
    damages: EntityDamage[],
    getGroupKey: (d: EntityDamage) => string,
): GroupedStats {
    const groupedTotalDamages: Record<string, number> = {};
    const groupedCount: Record<string, number> = {};
    const groupedCriticalCount: Record<string, number> = {};
    const groupedMinDamages: Record<string, number> = {};
    const groupedMaxDamages: Record<string, number> = {};
    const groupedDamages: Record<string, EntityDamage[]> = {};
    let totalDamage = 0;

    for (const d of damages) {
        const key = getGroupKey(d);
        totalDamage += d.Damage;

        if (!groupedDamages[key]) {
            groupedDamages[key] = [];
            groupedTotalDamages[key] = 0;
            groupedCount[key] = 0;
            groupedCriticalCount[key] = 0;
        }

        groupedDamages[key].push(d);
        groupedTotalDamages[key] += d.Damage;

        if (!countsTowardStats(d)) {
            continue;
        }

        groupedCount[key]++;
        if (d.IsCritical) {
            groupedCriticalCount[key]++;
        }

        if (!groupedMinDamages[key] || d.Damage < groupedMinDamages[key]) {
            groupedMinDamages[key] = d.Damage;
        }

        if (d.Damage > (groupedMaxDamages[key] ?? 0)) {
            groupedMaxDamages[key] = d.Damage;
        }
    }

    return { totalDamage, groupedTotalDamages, groupedDamages, groupedCount, groupedCriticalCount, groupedMinDamages, groupedMaxDamages };
}

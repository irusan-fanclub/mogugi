import type { EntityActor, EntityDamage } from '@/eventActor';
import { filterByTimeRange } from './timeRangeFilter';

/** Damage per second over first-to-last hit; 0 for <2 hits or a zero span. */
export function dpsOf(total: number, damages: { At: number }[]): number {
    if (!damages || damages.length < 2) return 0;
    const duration = damages[damages.length - 1].At - damages[0].At;
    return duration > 0 ? total / duration : 0;
}

export interface PlayerDamage {
    actor: EntityActor;
    damages: EntityDamage[];
    totalDamage: number;
    first?: EntityDamage;
    last?: EntityDamage;
}

export interface PlayerRowsInput {
    actors: EntityActor[];
    byAttacker: (id: string) => EntityDamage[];
    targetId: string;
    minAt: number | null;
    maxAt: number | null;
    /**
     * Collector aggregates for an attacker (already scoped to targetId and
     * unfiltered by time). When it returns a value the rescan is skipped.
     */
    preaggregated?: (id: string) => { damages: EntityDamage[]; total: number } | undefined;
}

/** PC rows under the target/time filter: total > 0 only, total damage desc. */
export function buildPlayerRows(input: PlayerRowsInput): PlayerDamage[] {
    const rows: PlayerDamage[] = [];
    for (const actor of input.actors) {
        if (!actor.isPC) continue;
        const pre = input.preaggregated?.(actor.id);
        if (pre) {
            if (pre.total <= 0) continue;
            const d = pre.damages;
            rows.push({ actor, damages: d, totalDamage: pre.total, first: d[0], last: d[d.length - 1] });
            continue;
        }
        const base = input.byAttacker(actor.id) ?? [];
        const scoped = input.targetId ? base.filter(d => d.TargetId === input.targetId) : base;
        const damages = filterByTimeRange(scoped, input.minAt, input.maxAt);
        let totalDamage = 0;
        for (const d of damages) totalDamage += d.Damage;
        if (totalDamage <= 0) continue;
        rows.push({ actor, damages, totalDamage, first: damages[0], last: damages[damages.length - 1] });
    }
    return rows.sort((a, b) => b.totalDamage - a.totalDamage);
}

/** part / all as a 0..1 fraction; 0 when the whole is empty. */
export function shareOf(part: number, all: number): number {
    return all > 0 ? part / all : 0;
}

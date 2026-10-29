import type { EntityConditionState } from '@/eventActor';

export interface TimelineSeries { name: string; points: [number, 0 | 1][] }
/** Maps a raw condition AttackerId to its owner-resolved id and display name. */
export type ResolveAttacker = (attackerId: string) => { id: string; name: string };

/** History restricted to [start, end] when both bounds are given. */
export function boundHistory(history: EntityConditionState[], start: number | null, end: number | null): EntityConditionState[] {
    if (start === null || end === null) return history;
    return history.filter(st => st.At >= start && st.At <= end);
}

/** Every CC id that ever appeared in the history, ascending. */
export function ccOptions(history: EntityConditionState[]): number[] {
    const ids = new Set<number>();
    for (const state of history) for (const cond of state.List) ids.add(cond.CCId);
    return [...ids].sort((a, b) => a - b);
}

/**
 * Stats window: the start/end bounds intersected with the global zoom range
 * (each edge only when both of its bounds exist), else the history's own span.
 */
export function statsWindow(
    history: EntityConditionState[],
    startTime: number | null,
    endTime: number | null,
    rangeMin: number | null,
    rangeMax: number | null,
): { start: number; end: number } | null {
    let start = startTime;
    let end = endTime;
    if (rangeMin !== null && rangeMax !== null) {
        start = start !== null ? Math.max(start, rangeMin) : rangeMin;
        end = end !== null ? Math.min(end, rangeMax) : rangeMax;
    }
    if (start !== null && end !== null) return { start, end };
    if (history.length === 0) return null;
    return { start: history[0].At, end: history[history.length - 1].At };
}

/**
 * One 0/1 step series per attacker holding the CC; with no attacker at all a single
 * "ON" series covers any holder. `unknownAsOn` also uses it when every AttackerId is
 * empty (the old chart named that lone series by its resolved name instead).
 */
export function series(
    history: EntityConditionState[],
    ccId: number,
    resolveName: ResolveAttacker,
    opts: { unknownAsOn?: boolean } = {},
): TimelineSeries[] {
    if (history.length === 0) return [];
    const attackers = new Map<string, string>();
    for (const state of history) {
        for (const cond of state.List) {
            if (cond.CCId !== ccId) continue;
            const r = resolveName(cond.AttackerId);
            if (!attackers.has(r.id)) attackers.set(r.id, r.name);
        }
    }
    const unknownOnly = attackers.size === 0 || (!!opts.unknownAsOn && attackers.size === 1 && attackers.has(''));
    if (unknownOnly) {
        return [{ name: 'ON', points: history.map(st => [st.At * 1000, st.List.some(c => c.CCId === ccId) ? 1 : 0] as [number, 0 | 1]) }];
    }
    return [...attackers].map(([id, name]) => ({
        name,
        points: history.map(st => [
            st.At * 1000,
            st.List.some(c => c.CCId === ccId && resolveName(c.AttackerId).id === id) ? 1 : 0,
        ] as [number, 0 | 1]),
    }));
}

/** Drops points that repeat the previous value (keeps first and last), for payload size. */
export function compressSteps(points: [number, 0 | 1][]): [number, 0 | 1][] {
    if (points.length <= 2) return points;
    const out: [number, 0 | 1][] = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
        if (points[i][1] !== out[out.length - 1][1]) out.push(points[i]);
    }
    out.push(points[points.length - 1]);
    return out;
}

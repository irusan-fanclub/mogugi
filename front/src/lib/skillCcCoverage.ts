import type { EntityConditionState, EntityDamage } from '@/eventActor';
import { CC_MERGE_MAP, mergedIds } from './effectTimeline';

/** Last state index with At <= at, or -1. */
function lastIdxAt(history: EntityConditionState[], at: number): number {
    let lo = 0, hi = history.length - 1, idx = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (history[mid].At <= at) { idx = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return idx;
}

/** Canonical CC id plus all its aliases; alias ids resolve to the same group. */
const groupIds = (ccId: number) => mergedIds(CC_MERGE_MAP[ccId] ?? ccId);

function activeAtIds(history: EntityConditionState[], ids: number[], at: number): boolean {
    const idx = lastIdxAt(history, at);
    return idx >= 0 && history[idx].List.some(c => ids.includes(c.CCId));
}

/** CC (or a merged alias) active at `at`: last state with At <= at contains it. */
export function ccActiveAt(history: EntityConditionState[], ccId: number, at: number): boolean {
    return activeAtIds(history, groupIds(ccId), at);
}

/** CCs (merged to their canonical id) in force at `from` or appearing within [from, to]. */
export function ccSeenIn(history: EntityConditionState[], from: number, to: number): Set<number> {
    const seen = new Set<number>();
    const add = (st: EntityConditionState) => { for (const c of st.List) seen.add(CC_MERGE_MAP[c.CCId] ?? c.CCId); };
    const start = lastIdxAt(history, from);
    if (start >= 0) add(history[start]);
    for (const st of history) {
        if (st.At > from && st.At <= to) add(st);
    }
    return seen;
}

export interface CcCover { ccId: number; covered: number; total: number }

export function skillCcCoverage(i: {
    hits: EntityDamage[];
    ccIds: number[];
    historyOf: (hit: EntityDamage) => EntityConditionState[];
}): CcCover[] {
    const covered = i.ccIds.map(() => 0);
    // Alias lists are resolved once per CC, not per hit.
    const groups = i.ccIds.map(groupIds);
    for (const h of i.hits) {
        const hist = i.historyOf(h);
        groups.forEach((ids, k) => { if (activeAtIds(hist, ids, h.At)) covered[k]++; });
    }
    return i.ccIds.map((ccId, k) => ({ ccId, covered: covered[k], total: i.hits.length }));
}

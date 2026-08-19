import type { EntityConditionState, EntityCondition } from '@/eventActor';

export type ConditionSource = {
    history: EntityConditionState[];
    /** When given, only these CCIds are taken from this source. */
    ccIds?: readonly number[];
};

/**
 * Folds several condition histories into one. A CC is present at time T if it
 * is present in any source at T, which is what makes a party-wide track read
 * as "someone has this on" rather than as one particular player's state.
 *
 * Consecutive states carrying the same set of CCIds collapse into one entry,
 * so merging N players does not multiply the history by N.
 */
/**
 * Drops the states a filtered source cannot contribute to, before its
 * timestamps reach the union below.
 *
 * A party member is read for two CCs but carries every condition they ever
 * had: one real log had 43,958 states behind 2 awakenings. Filtering per
 * entry inside the merge still paid for all 43,958 timestamps — a sort and a
 * merge step each — to emit two. The mask keeps this allocation-free until
 * the relevant set actually changes.
 */
function keepOnly(history: EntityConditionState[], ccIds: readonly number[]): EntityConditionState[] {
    const out: EntityConditionState[] = [];
    let prevMask = -1;
    for (const st of history) {
        let mask = 0;
        for (const c of st.List) {
            const bit = ccIds.indexOf(c.CCId);
            if (bit >= 0) mask |= 1 << bit;
        }
        if (mask === prevMask) continue;
        prevMask = mask;
        out.push({ At: st.At, List: mask === 0 ? [] : st.List.filter(c => ccIds.includes(c.CCId)) });
    }
    return out;
}

export function mergeConditionHistories(sources: ConditionSource[]): EntityConditionState[] {
    // ccIds is applied here, not per entry below, so a filtered source is just
    // a history from this point on and cannot smuggle its other CCs through.
    const usable = sources
        .map(s => (s.ccIds ? keepOnly(s.history, s.ccIds) : s.history))
        .filter(h => h.length > 0);
    if (usable.length === 0) return [];
    if (usable.length === 1) return usable[0].slice();

    const times = new Set<number>();
    for (const h of usable) for (const st of h) times.add(st.At);
    const sorted = [...times].sort((a, b) => a - b);

    // One cursor per source instead of a scan per timestamp: the histories are
    // already sorted, so this stays linear as players are added.
    const cursor = usable.map(() => -1);
    const out: EntityConditionState[] = [];
    let prevKey = '';

    for (const at of sorted) {
        const list: EntityCondition[] = [];
        const seen = new Set<number>();
        for (let i = 0; i < usable.length; i++) {
            const h = usable[i];
            while (cursor[i] + 1 < h.length && h[cursor[i] + 1].At <= at) cursor[i]++;
            if (cursor[i] < 0) continue;
            for (const c of h[cursor[i]].List) {
                if (seen.has(c.CCId)) continue;
                seen.add(c.CCId);
                list.push(c);
            }
        }
        const key = [...seen].sort((a, b) => a - b).join(',');
        if (key === prevKey) continue;
        prevKey = key;
        out.push({ At: at, List: list });
    }
    return out;
}

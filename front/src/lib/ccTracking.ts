// Setting keys; see settingsStorage.
const CC_STORAGE_KEY = 'trackedDebuffCCIds';
const CHART_HIDDEN_KEY = 'chartHiddenCCIds';

const SELF_STORAGE_KEY = 'trackedSelfCCIds';
const SELF_CHART_HIDDEN_KEY = 'chartHiddenSelfCCIds';

export const DEFAULT_CC_LIST: number[] = [
    803, 1026, 464, 578, 10002, 10001,
    1164, 1165, 1166, 392, 912, 1093, 598, 1138,
    323, 1122, 1161,
];
// Coverage only (no lane).
export const DEFAULT_CHART_HIDDEN: number[] = [1164, 1165, 1166, 1093, 392, 912, 598, 1138];
// Self-buff list: unpinned; shows the owner's own CCs (覺醒, 戰吼 included).
export const DEFAULT_SELF_CC_LIST: number[] = [900206, 516, 476, 1225, 577, 680, 406, 407, 408, 511, 1037, 1123];
export const DEFAULT_SELF_CHART_HIDDEN: number[] = [680, 406, 407, 408, 511, 1225];
export const ADD_LIST_MAX_ROWS = 300;

export function loadTracked(storage: Storage): number[] {
    try {
        const raw = storage.getItem(CC_STORAGE_KEY);
        if (raw) {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) return list as number[];
        }
    } catch { /* ignore */ }
    return [...DEFAULT_CC_LIST];
}

export function saveTracked(storage: Storage, list: number[]): void {
    storage.setItem(CC_STORAGE_KEY, JSON.stringify(list));
}

export function loadChartHidden(storage: Storage): Set<number> {
    try {
        const raw = storage.getItem(CHART_HIDDEN_KEY);
        if (raw) return new Set(JSON.parse(raw) as number[]);
    } catch { /* ignore */ }
    return new Set(DEFAULT_CHART_HIDDEN);
}

export function saveChartHidden(storage: Storage, hidden: Set<number>): void {
    storage.setItem(CHART_HIDDEN_KEY, JSON.stringify([...hidden]));
}

export function loadSelfTracked(storage: Storage): number[] {
    try {
        const raw = storage.getItem(SELF_STORAGE_KEY);
        if (raw) {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) return list as number[];
        }
    } catch { /* ignore */ }
    return [...DEFAULT_SELF_CC_LIST];
}

export function saveSelfTracked(storage: Storage, list: number[]): void {
    storage.setItem(SELF_STORAGE_KEY, JSON.stringify(list));
}

export function loadSelfChartHidden(storage: Storage): Set<number> {
    try {
        const raw = storage.getItem(SELF_CHART_HIDDEN_KEY);
        if (raw) {
            const list = JSON.parse(raw);
            if (Array.isArray(list)) return new Set(list as number[]);
        }
    } catch { /* ignore */ }
    return new Set(DEFAULT_SELF_CHART_HIDDEN);
}

export function saveSelfChartHidden(storage: Storage, hidden: Set<number>): void {
    storage.setItem(SELF_CHART_HIDDEN_KEY, JSON.stringify([...hidden]));
}

/** Move one item; the first pinnedCount positions (default none) are pinned. Returns a new list. */
export function reorder(list: number[], from: number, to: number, pinnedCount = 0): number[] {
    const out = [...list];
    if (from === to || from < pinnedCount || to < pinnedCount) return out;
    const [item] = out.splice(from, 1);
    out.splice(to, 0, item);
    return out;
}

/** Move the from-th to the to-th of the ids in members; other ids keep their positions. */
export function reorderWithin(list: number[], members: (id: number) => boolean, from: number, to: number): number[] {
    const slots = list.flatMap((id, i) => (members(id) ? [i] : []));
    const moved = reorder(slots.map(i => list[i]), from, to);
    const out = [...list];
    slots.forEach((slot, k) => { out[slot] = moved[k]; });
    return out;
}

/** CC ids present in a condition history. */
export function seenCCIds(history: { List: { CCId: number }[] }[]): Set<number> {
    const ids = new Set<number>();
    for (const st of history) for (const c of st.List) ids.add(c.CCId);
    return ids;
}

export interface AvailableCCsInput {
    tracked: number[];
    /** CC ids seen on the selected target. */
    targetCCIds: Iterable<number>;
    /** Whole catalogue to offer too, or null for "seen only". */
    catalogue: Iterable<number> | null;
    search: string | null;
    nameOf: (id: number) => string | undefined;
    /** Built-in ids to offer; defaults to DEFAULT_CC_LIST. */
    defaults?: Iterable<number>;
}

/** Untracked CCs to offer, sorted by id, filtered by search, capped at 300. */
export function availableCCs(input: AvailableCCsInput): { list: number[]; overflow: number } {
    const tracked = new Set(input.tracked);
    const ids = new Set<number>();
    for (const id of input.targetCCIds) if (!tracked.has(id)) ids.add(id);
    for (const id of input.defaults ?? DEFAULT_CC_LIST) if (!tracked.has(id)) ids.add(id);
    if (input.catalogue) {
        for (const id of input.catalogue) if (!tracked.has(id)) ids.add(id);
    }
    // A cleared v-text-field model is null, so guard before lowercasing.
    const search = (input.search ?? '').toLowerCase();
    const all = [...ids].sort((a, b) => a - b).filter(id => {
        if (!search) return true;
        const name = input.nameOf(id) ?? '';
        return name.toLowerCase().includes(search) || String(id).includes(search);
    });
    return { list: all.slice(0, ADD_LIST_MAX_ROWS), overflow: Math.max(0, all.length - ADD_LIST_MAX_ROWS) };
}

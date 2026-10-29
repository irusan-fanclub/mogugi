import type { EntityConditionState } from '../eventActor';

// Synthetic condition for the 0x7533 boss-invincible flag.
export const BOSS_INVINCIBLE_CC_ID = 91000;
// Unioned even where the boss still takes damage (277 can).
export const INVINCIBLE_CC_IDS: readonly number[] = [BOSS_INVINCIBLE_CC_ID, 494, 277];
export const MIN_INVINCIBLE_SEC = 2;
export const OPENING_SEC = 5;

// Seconds, half-open [a, b).
export type Span = [number, number];

export interface CcToggle { At: number; CCId: number; on: boolean }

/** Diff consecutive condition lists into on/off toggles for the given CCs. */
export function togglesFromHistory(history: EntityConditionState[], ccIds: readonly number[]): CcToggle[] {
    const out: CcToggle[] = [];
    let prev = new Set<number>();
    for (const state of history) {
        const cur = new Set<number>();
        for (const c of state.List) {
            if (ccIds.includes(c.CCId)) cur.add(c.CCId);
        }
        for (const id of cur) if (!prev.has(id)) out.push({ At: state.At, CCId: id, on: true });
        for (const id of prev) if (!cur.has(id)) out.push({ At: state.At, CCId: id, on: false });
        prev = cur;
    }
    return out;
}

function mergeSpans(spans: Span[]): Span[] {
    const sorted = spans.map(s => [s[0], s[1]] as Span).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const merged: Span[] = [];
    for (const s of sorted) {
        const last = merged[merged.length - 1];
        if (last && s[0] <= last[1]) last[1] = Math.max(last[1], s[1]);
        else merged.push(s);
    }
    return merged;
}

/** Pair toggles per CC, union all CCs, drop merged spans shorter than MIN_INVINCIBLE_SEC. */
export function invincibleWindows(toggles: CcToggle[], endSec: number): Span[] {
    const open = new Map<number, number>();
    const spans: Span[] = [];
    const ordered = toggles.map((t, i) => ({ t, i })).sort((x, y) => x.t.At - y.t.At || x.i - y.i);
    for (const { t } of ordered) {
        if (t.on) {
            if (!open.has(t.CCId)) open.set(t.CCId, t.At);
        } else {
            const a = open.get(t.CCId);
            if (a !== undefined) {
                spans.push([a, t.At]);
                open.delete(t.CCId);
            }
        }
    }
    for (const a of open.values()) spans.push([a, endSec]);
    return mergeSpans(spans).filter(s => s[1] - s[0] >= MIN_INVINCIBLE_SEC);
}

export function invincibleOf(history: EntityConditionState[] | undefined, endSec: number): Span[] {
    return history?.length ? invincibleWindows(togglesFromHistory(history, INVINCIBLE_CC_IDS), endSec) : [];
}

/** One player death (Dead) or revive (!Dead). */
export interface DeathToggle { At: number; Dead: boolean }

/** Pair each death with the next revive; a death still open closes at endSec. */
export function deathSpans(toggles: DeathToggle[], endSec: number): Span[] {
    const ordered = toggles.map((t, i) => ({ t, i })).sort((x, y) => x.t.At - y.t.At || x.i - y.i);
    const out: Span[] = [];
    let from: number | null = null;
    for (const { t } of ordered) {
        if (t.Dead && from === null) from = t.At;
        else if (!t.Dead && from !== null) {
            out.push([from, t.At]);
            from = null;
        }
    }
    if (from !== null) out.push([from, endSec]);
    return out;
}

export function excludedSpans(fightStart: number, invincible: Span[]): Span[] {
    return mergeSpans([[fightStart, fightStart + OPENING_SEC], ...invincible]);
}

/** Window time left after removing the excluded spans: the activeDps denominator. */
export function activeSeconds(windows: Span[], excluded: Span[]): number {
    let time = 0;
    for (const [a, b] of windows) {
        time += b - a;
        for (const [x, y] of excluded) {
            time -= Math.max(0, Math.min(b, y) - Math.max(a, x));
        }
    }
    return Math.max(0, time);
}

export function isExcluded(at: number, excluded: Span[]): boolean {
    return excluded.some(([x, y]) => at >= x && at < y);
}

/** Damage outside excluded spans divided by window time outside them; null when no time remains. */
export function activeDps(hits: { At: number; Damage: number }[], windows: Span[], excluded: Span[]): number | null {
    const time = activeSeconds(windows, excluded);
    if (time <= 0) return null;
    let dmg = 0;
    for (const h of hits) {
        if (!isExcluded(h.At, excluded)) dmg += h.Damage;
    }
    return dmg / time;
}

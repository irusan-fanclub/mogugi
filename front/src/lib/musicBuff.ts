import type { EntityCondition, EntityConditionState } from '@/eventActor';
import { clipToWindow, computeCCCoverage } from '@/lib/conditionCoverage';

/** 戰場的序曲 (680) and 活潑板 (192) are mutually exclusive — at most one is active at a time. */
export const MUSIC_CC_IDS = [680, 192] as const;

// The headline magnitude key differs per song; see the spec's table.
const HEADLINE_KEY: Record<number, string> = { 680: 'MCMBAMIN', 192: 'LSMA' };

const isMusicCond = (c: EntityCondition): boolean => (MUSIC_CC_IDS as readonly number[]).includes(c.CCId);

export type MusicBuffCell =
  | { kind: 'absent' }
  | {
      kind: 'present';
      ccId: number;          // song at the window tail (or last known)
      firstPct: number;      // first value seen
      lastPct: number;       // value at the window tail (or last known)
      songChanged: boolean;  // CCId changed within the window
      coverage: number;      // 0..1
      isOn: boolean;         // whether ON at the window tail
      /** [start, end] the first/last value was in force, absolute seconds. */
      firstRange: [number, number];
      lastRange: [number, number];
      /** Every uninterrupted same-value stretch, in order. */
      runs: Array<{ ccId: number; pct: number; range: [number, number] }>;
    };

export function deriveMusicBuffCell(
    history: EntityConditionState[], windowStart: number, windowEnd: number,
): MusicBuffCell {
    // Owns both window edges (spec 5): clip trailing entries past windowEnd,
    // and seed windowStart with whatever state was already in force there,
    // so a pre-window on/off or song change never leaks into the result.
    const windowed = clipToWindow(history, windowStart, windowEnd);

    // Every windowed state that carries a music CC, with its headline value parsed.
    // Unparseable values are dropped per spec note 3 — they can't anchor first/lastPct.
    // Runs: uninterrupted stretches of one value. A refresh at the same value
    // extends the run; a gap (music off) or a value/song change starts a new
    // one — the display prints each run with the span it was in force.
    type Run = { ccId: number; pct: number; range: [number, number] };
    const endOf = (i: number) => (i + 1 < windowed.length ? windowed[i + 1].At : windowEnd);
    const runs: Run[] = [];
    let open: Run | null = null;
    for (let i = 0; i < windowed.length; i++) {
        const state = windowed[i];
        const cond = state.List.find(isMusicCond);
        if (!cond) {
            if (open) open.range[1] = state.At;
            open = null;
            continue;
        }
        const pct = parseFloat(cond.Params[HEADLINE_KEY[cond.CCId]]);
        if (Number.isNaN(pct)) continue;   // can't anchor a value (spec note 3)
        if (open && open.ccId === cond.CCId && open.pct === pct) {
            open.range[1] = endOf(i);
            continue;
        }
        if (open) open.range[1] = state.At;
        // A brief lapse (overlap re-apply, or resumed within 1s) at the same
        // song and value is not a real break - rejoin the previous run
        // instead of printing a spurious segment (and 😠).
        const prev = runs[runs.length - 1];
        if (prev && prev.ccId === cond.CCId && prev.pct === pct &&
            state.At - prev.range[1] <= 1) {
            prev.range[1] = endOf(i);
            open = prev;
            continue;
        }
        open = { ccId: cond.CCId, pct, range: [state.At, endOf(i)] };
        runs.push(open);
    }
    if (runs.length === 0) return { kind: 'absent' };

    const first = runs[0];
    const last = runs[runs.length - 1];
    const songChanged = new Set(runs.map(r => r.ccId)).size > 1;
    const isOn = windowed[windowed.length - 1].List.some(isMusicCond);

    const windowSec = Math.max(0, windowEnd - windowStart);
    // windowSec > 0 guarantees the numerator (on-time within the window) can't
    // exceed it, so no clamp is needed — a ratio above 1 here would be a real bug.
    const coverage = windowSec > 0 ? computeCCCoverage(history, MUSIC_CC_IDS, windowStart, windowEnd).onSec / windowSec : 0;

    return {
        kind: 'present',
        ccId: last.ccId,
        firstPct: first.pct,
        lastPct: last.pct,
        songChanged,
        coverage,
        isOn,
        firstRange: [...first.range] as [number, number],
        lastRange: [...last.range] as [number, number],
        runs,
    };
}

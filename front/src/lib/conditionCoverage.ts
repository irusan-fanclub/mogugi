import type { EntityCondition, EntityConditionState } from '@/eventActor';

export type CCCoverageResult = {
    totalSec: number;
    onSec: number;
};

/**
 * Slice history to [windowStart, windowEnd]: drop entries after windowEnd,
 * and prepend a synthetic entry at windowStart carrying forward the state
 * in force at or before it (the last-known state persists as a step function).
 */
export function clipToWindow(
    history: EntityConditionState[], windowStart: number, windowEnd: number,
): EntityConditionState[] {
    let seedList: EntityCondition[] = [];
    const withinWindow: EntityConditionState[] = [];
    for (const state of history) {
        if (state.At <= windowStart) seedList = state.List;
        else if (state.At <= windowEnd) withinWindow.push(state);
    }
    return [{ At: windowStart, List: seedList }, ...withinWindow];
}

/**
 * On-time of a CC (or a set of merged CC aliases) over an explicit
 * [startAt, endAt] window. Both edges must come from the caller — a
 * denominator derived from the data itself lets a history that starts
 * before/after the real window silently dilute every coverage number.
 */
export function computeCCCoverage(
    history: EntityConditionState[],
    ccIds: readonly number[],
    startAt: number,
    endAt: number,
): CCCoverageResult {
    return computeCCCoverageBy(history, c => ccIds.includes(c.CCId), startAt, endAt);
}

/** Same as above but with an arbitrary per-condition predicate (e.g. attacker filter). */
export function computeCCCoverageBy(
    history: EntityConditionState[],
    predicate: (cond: EntityCondition) => boolean,
    startAt: number,
    endAt: number,
): CCCoverageResult {
    const totalSec = Math.max(0, endAt - startAt);
    if (totalSec === 0) return { totalSec: 0, onSec: 0 };
    const windowed = clipToWindow(history, startAt, endAt);
    let onSec = 0;
    for (let i = 0; i < windowed.length; i++) {
        const segEnd = i + 1 < windowed.length ? windowed[i + 1].At : endAt;
        if (windowed[i].List.some(predicate)) onSec += segEnd - windowed[i].At;
    }
    return { totalSec, onSec };
}

export type CCTimelineSegment = { start: number; end: number };

/** Active intervals (seconds) for a single CC, taken from the history. */
export function getCCTimelineSegments(
    history: EntityConditionState[],
    ccId: number,
): CCTimelineSegment[] {
    if (history.length < 2) return [];
    const segments: CCTimelineSegment[] = [];
    let segStart: number | null = null;
    for (let i = 0; i < history.length; i++) {
        const active = history[i].List.some(c => c.CCId === ccId);
        if (active && segStart === null) {
            segStart = history[i].At;
        } else if (!active && segStart !== null) {
            segments.push({ start: segStart, end: history[i].At });
            segStart = null;
        }
    }
    if (segStart !== null) {
        segments.push({ start: segStart, end: history[history.length - 1].At });
    }
    return segments;
}

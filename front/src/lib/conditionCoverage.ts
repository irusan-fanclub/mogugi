import type { EntityCondition, EntityConditionState } from '@/eventActor';

export type CCCoverageResult = {
    totalSec: number;
    onSec: number;
};

/**
 * On-time of a CC (or a set of merged CC aliases) over a history window.
 *
 * Pass `fightEndAt` (in seconds) to extend the trailing on-segment past
 * the last history entry — useful when _conditionHistory only grows on
 * set-membership change but you want coverage relative to "now".
 */
export function computeCCCoverage(
    history: EntityConditionState[],
    ccIds: readonly number[],
    fightEndAt?: number,
): CCCoverageResult {
    return computeCCCoverageBy(history, c => ccIds.includes(c.CCId), fightEndAt);
}

/** Same as above but with an arbitrary per-condition predicate (e.g. attacker filter). */
export function computeCCCoverageBy(
    history: EntityConditionState[],
    predicate: (cond: EntityCondition) => boolean,
    fightEndAt?: number,
): CCCoverageResult {
    if (history.length === 0) return { totalSec: 0, onSec: 0 };
    const endAt = fightEndAt ?? history[history.length - 1].At;
    const totalSec = Math.max(0, endAt - history[0].At);
    if (totalSec === 0) return { totalSec: 0, onSec: 0 };
    let onSec = 0;
    for (let i = 0; i < history.length; i++) {
        const segEnd = i + 1 < history.length ? history[i + 1].At : endAt;
        if (history[i].List.some(predicate)) onSec += segEnd - history[i].At;
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

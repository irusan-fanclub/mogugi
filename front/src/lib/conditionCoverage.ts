import type { EntityConditionState } from '@/eventActor';

export type CCCoverageResult = {
    totalSec: number;
    onSec: number;
};

/**
 * Compute the total uptime of a condition over the entity's history.
 * Returns { totalSec, onSec } where totalSec is the observation window
 * and onSec is the time the condition was active (from any attacker).
 */
export function computeCCCoverage(
    history: EntityConditionState[],
    ccId: number,
): CCCoverageResult {
    if (history.length < 2) return { totalSec: 0, onSec: 0 };
    const totalSec = history[history.length - 1].At - history[0].At;
    let onSec = 0;
    for (let i = 0; i < history.length - 1; i++) {
        if (history[i].List.some(c => c.CCId === ccId)) {
            onSec += history[i + 1].At - history[i].At;
        }
    }
    return { totalSec, onSec };
}

export type CCTimelineSegment = { start: number; end: number };

/**
 * Extract active time segments for a condition from the history.
 * Returns an array of { start, end } pairs (in seconds) where the
 * condition was continuously active.
 */
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
    // Close trailing segment
    if (segStart !== null) {
        segments.push({ start: segStart, end: history[history.length - 1].At });
    }
    return segments;
}

/**
 * Collect all unique CC IDs that appear in the history, excluding a
 * set of hidden IDs. Returns sorted by ID.
 */
export function getCCIdsFromHistory(
    history: EntityConditionState[],
    hiddenIds?: Set<number>,
): number[] {
    const ids = new Set<number>();
    for (const state of history) {
        for (const cond of state.List) {
            if (!hiddenIds?.has(cond.CCId)) {
                ids.add(cond.CCId);
            }
        }
    }
    return [...ids].sort((a, b) => a - b);
}

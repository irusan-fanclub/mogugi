import type { EntityActor, EntityConditionState, EntityDamage } from '@/eventActor';
import type { eventBardsong, eventBardsongPulse } from '@/protocols';
import { computeCCCoverage } from './conditionCoverage';
import { mergeConditionHistories } from './mergeConditions';
import { BARDSONG_CC_ID, buildBardsongConditionHistory, ownerAt, type OwnerChange } from './bardsongTrack';
import type { CastRecord } from './castDetect';
import { filterByTimeRange } from './timeRangeFilter';

// Alias CC id -> the id it is shown (and counted) as.
export const CC_MERGE_MAP: Record<number, number> = { 913: 912, 504: 392, 1094: 1093 };

export function mergedIds(ccId: number): number[] {
    const aliases = Object.entries(CC_MERGE_MAP)
        .filter(([, c]) => c === ccId).map(([a]) => Number(a));
    return [ccId, ...aliases];
}

export interface SelfHistoryInput {
    self: EntityActor | undefined;
    bardsongEvents: readonly eventBardsong[];
    bardsongPulses: readonly eventBardsongPulse[];
    owners: readonly OwnerChange[];
}

// The owner's own conditions; 戰吼 comes from their real history, else the synthetic owner track.
// The bard-song and owner arrays are spread so a reactive caller tracks their length.
export function buildSelfHistory(input: SelfHistoryInput): EntityConditionState[] {
    if (!input.self) return [];
    const own = input.self.conditionHistory;
    const real = own.some(st => st.List.some(c => c.CCId === BARDSONG_CC_ID));
    const synthetic = real ? []
        : buildBardsongConditionHistory([...input.bardsongEvents], [...input.bardsongPulses], [...input.owners]);
    return mergeConditionHistories([{ history: own }, { history: synthetic }]);
}

// Only the fight owner has the synthetic 戰吼 track; other players keep their own history.
export function playerSelfHistory(actor: EntityActor | undefined, isOwner: boolean, rest: Omit<SelfHistoryInput, 'self'>): EntityConditionState[] {
    return isOwner ? buildSelfHistory({ ...rest, self: actor }) : actor?.conditionHistory ?? [];
}

// Damage-only on purpose: party condition histories span the whole log, so a
// CC must never stretch the fight (and the chart axis) to a later fight.
export function fightSpan(entities: { damages: { At: number }[] }[]): { start: number; end: number } | null {
    let start = Infinity, end = -Infinity;
    for (const e of entities) {
        for (const d of e.damages) {
            if (d.At < start) start = d.At;
            if (d.At > end) end = d.At;
        }
    }
    return isFinite(start) ? { start, end } : null;
}

// Tracked CCs that appear in `history` (aliases folded) and are not chart-hidden.
export function laneIds(tracked: number[], chartHidden: Set<number>, history: EntityConditionState[]): number[] {
    const seen = new Set<number>();
    for (const st of history) {
        for (const c of st.List) seen.add(CC_MERGE_MAP[c.CCId] ?? c.CCId);
    }
    return tracked.filter(id => seen.has(id) && !chartHidden.has(id));
}

// Step points [ms since origin, on/off]; a still-active last state is pinned to endSec
// because the history only grows when set membership changes.
export function laneSeries(
    history: EntityConditionState[], ccId: number, origin: number, endSec: number,
): [number, 0 | 1][] {
    const ids = mergedIds(ccId);
    const out: [number, 0 | 1][] = [];
    let last: 0 | 1 = 0;
    for (const st of history) {
        last = st.List.some(c => ids.includes(c.CCId)) ? 1 : 0;
        const x = (st.At - origin) * 1000;
        // One point per instant: ECharts' axis tooltip lists every point tied for nearest.
        if (out.length > 0 && out[out.length - 1][0] === x) {
            out[out.length - 1][1] = last;
            if (out.length > 1 && out[out.length - 2][1] === last) out.pop();
            continue;
        }
        // Only the switches: ECharts skips line segments under 2px, which turns a step corner
        // into a slant where points crowd (a narrow screenshot).
        if (out.length > 0 && out[out.length - 1][1] === last) continue;
        out.push([x, last]);
    }
    if (last === 1 && out.length > 0 && out[out.length - 1][0] < (endSec - origin) * 1000) out.push([(endSec - origin) * 1000, 1]);
    return out;
}

export type CoverageColor = 'ok' | 'warn' | 'err';
export interface CoverageRow { ccId: number; pct: number; color: CoverageColor; onChart: boolean }

export function coverageColor(pct: number): CoverageColor {
    return pct >= 60 ? 'ok' : pct >= 40 ? 'warn' : 'err';
}

// Always over the whole fight [start, end], never the zoom range. Unseen CCs show 0%.
export function coverageRows(input: {
    tracked: number[]; chartHidden: Set<number>; history: EntityConditionState[]; start: number; end: number;
}): CoverageRow[] {
    return input.tracked.map(ccId => {
        const { totalSec, onSec } = computeCCCoverage(input.history, mergedIds(ccId), input.start, input.end);
        const pct = totalSec > 0 ? 100 * onSec / totalSec : 0;
        return { ccId, pct, color: coverageColor(pct), onChart: !input.chartHidden.has(ccId) };
    });
}

// id is the player's entity id; the chart colours lines by list order, and player rows match it by id.
export interface DpsEntity { name: string; damages: EntityDamage[]; id?: string }

// One entry per PC with damage (pets excluded upstream), optional target/time filter, biggest first.
export function buildDpsEntities(input: {
    grouped: Record<string, EntityDamage[]>;
    actorOf: (id: string) => { isPC: boolean } | undefined;
    nameOf: (actor: never, id: string) => string | undefined;
    targetId: string;
    minAt: number | null;
    maxAt: number | null;
}): DpsEntity[] {
    const out: (DpsEntity & { total: number })[] = [];
    for (const k in input.grouped) {
        const actor = input.actorOf(k);
        if (!actor || !actor.isPC) continue;
        let damages = input.grouped[k] || [];
        if (input.targetId) damages = damages.filter(d => d.TargetId === input.targetId);
        damages = filterByTimeRange(damages, input.minAt, input.maxAt);
        if (damages.length === 0) continue;
        out.push({ id: k, name: input.nameOf(actor as never, k) || k, damages, total: damages.reduce((s, d) => s + d.Damage, 0) });
    }
    return out.sort((a, b) => b.total - a.total).map(({ id, name, damages }) => ({ id, name, damages }));
}

// The local player at fight start; '' when no owner was ever reported.
export function fightOwner(owners: readonly OwnerChange[], fightStart: number): string {
    return ownerAt(owners, fightStart);
}

// Cast times (ms since origin, sorted) of a lane's CC, aliases folded, within [start, end].
export function castTicks(
    casts: readonly CastRecord[], ccId: number, origin: number, start: number, end: number,
): number[] {
    const ids = mergedIds(ccId);
    return casts
        .filter(c => ids.includes(c.CCId) && c.At >= start && c.At <= end)
        .map(c => (c.At - origin) * 1000)
        .sort((a, b) => a - b);
}

// Ticks where the CC turns on after being off (or is on in the very first state).
export function runStartTicks(
    history: EntityConditionState[], ccId: number, origin: number, start: number, end: number,
): number[] {
    const ids = mergedIds(ccId);
    const out: number[] = [];
    let prev = false;
    for (const st of history) {
        const on = st.List.some(c => ids.includes(c.CCId));
        if (on && !prev && st.At >= start && st.At <= end) out.push((st.At - origin) * 1000);
        prev = on;
    }
    return out;
}

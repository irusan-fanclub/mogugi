import type { EntityConditionState } from '@/eventActor';
import type { ChartSpec } from '@/lib/chartProtocol';
import { actorManager, condNameMap, raceNameMap, timeRangeMax, timeRangeMin } from '@/store';
import { computeCCCoverage } from '@/lib/conditionCoverage';
import {
    boundHistory, ccOptions, compressSteps, series, statsWindow, type ResolveAttacker, type TimelineSeries,
} from '@/lib/conditionTimeline';
import { prettyEntityName } from '@/lib/util';
import { inTimeRange, playerBucket, rangeKey } from './hubSources';
import type { KindProvider } from './hubTypes';

export interface ConditionPayload {
    options: { id: number; name: string; icon: string }[];
    /** Selected CC, -1 when the history has none. */
    ccId: number;
    /** Seconds in the stats window / seconds the CC was on within it. */
    total: number;
    on: number;
    series: TimelineSeries[];
}

// The option scan walks the whole history, so cache it per history until it grows or the bounds change.
const optionCache = new WeakMap<EntityConditionState[], { sig: string; ids: number[] }>();
function optionsOf(history: EntityConditionState[], start: number | null, end: number | null): number[] {
    const sig = [history.length, history[0]?.At, history[history.length - 1]?.At, start, end].join('|');
    const hit = optionCache.get(history);
    if (hit && hit.sig === sig) return hit.ids;
    const ids = ccOptions(boundHistory(history, start, end));
    optionCache.set(history, { sig, ids });
    return ids;
}

const ccName = (id: number) => condNameMap.value[id] ?? `CC ${id}`;

/** One player's condition history; a selected target bounds it to that player's hits on it. */
export const conditionProvider: KindProvider = (spec: ChartSpec, opts, env) => {
    if (spec.kind !== 'condition') return null;
    const { attackerId } = spec;
    const actor = actorManager.value.entityMap[attackerId];
    const history = actor?.conditionHistory ?? [];
    const tid = env.targetId();

    // Target-bounded window: first/last hit on the selected target (needs 2+ hits), as the old dialog.
    const bucket = tid ? playerBucket(env.collector(attackerId), tid) : null;
    let start: number | null = null;
    let end: number | null = null;
    if (bucket) {
        const ds = inTimeRange(bucket.damages);
        if (ds.length >= 2) { start = ds[0].At; end = ds[ds.length - 1].At; }
    }

    const ids = optionsOf(history, start, end);
    const ccId = opts.ccId !== undefined && ids.includes(opts.ccId) ? opts.ccId : (ids[0] ?? -1);
    const player = env.actorName(attackerId);
    const title = ccId >= 0 ? `${ccName(ccId)} - ${player}` : `CC - ${player}`;

    return {
        title,
        key: [
            'cond', history.length, history[0]?.At, history[history.length - 1]?.At, ccId, rangeKey(), tid, start, end, title,
        ].join('|'),
        build: (): ConditionPayload => {
            const w = statsWindow(history, start, end, timeRangeMin.value, timeRangeMax.value);
            const cov = ccId >= 0 && w ? computeCCCoverage(history, [ccId], w.start, w.end) : { totalSec: 0, onSec: 0 };
            const resolve: ResolveAttacker = id => {
                const rid = actorManager.value.entityMap[id]?.ownerId || id;
                return { id: rid, name: prettyEntityName(actorManager.value.entityMap[rid], raceNameMap) || 'unknown' };
            };
            const lines = ccId >= 0 ? series(boundHistory(history, start, end), ccId, resolve, { unknownAsOn: true }) : [];
            return {
                options: ids.map(id => ({ id, name: ccName(id), icon: `/icons/cc/${id}.png` })),
                ccId,
                total: cov.totalSec,
                on: cov.onSec,
                series: lines.map(s => ({ name: s.name, points: compressSteps(s.points) })),
            };
        },
    };
};

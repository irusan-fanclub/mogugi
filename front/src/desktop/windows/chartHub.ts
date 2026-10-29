import type { DamageCollectorBase, DualGroupedDamageCollector } from '@/actionCollector';
import { chartOn, chartEmit, chartHubId } from '@/lib/chartTransport';
import { EV, type ChartData, type ChartOpts, type ChartSpec } from '@/lib/chartProtocol';
import { watch } from 'vue';
import { isDesktop } from '@/lib/runtimeEnv';
import { actorManager, clearTimeRange, dcManager, raceNameMap, setTimeRange, skillNameMap, timeRangeMax, timeRangeMin } from '@/store';
import { prettyEntityName } from '@/lib/util';
import { selectedTargetId } from '../tabs/battle/battleSelection';
import { conditionProvider } from './conditionPayload';
import { hitlogProvider } from './hitlogPayload';
import type { HubEnv, KindProvider } from './hubTypes';

export const HUB_INTERVAL_MS = 500;
const HUB_BEAT_MS = 5000;

// Payload kinds register a provider (see hubTypes.ts).
const providers: KindProvider[] = [conditionProvider, hitlogProvider];
export function registerChartKind(provider: KindProvider): void {
    providers.push(provider);
}

interface Win { spec: ChartSpec; opts: ChartOpts; version?: number }

// 32-bit FNV-1a: only used to detect "input changed", not for security.
function hash(s: string): number {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
    return h;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

/**
 * Serves chart windows from the main window's store: remembers each window's
 * spec, answers hello at once, then re-checks every 500 ms and sends only when
 * the input changed. Resolves to a stop function after main-ready went out.
 */
export async function startChartHub(): Promise<() => void> {
    const wins = new Map<string, Win>();
    const collectors = new Map<string, DualGroupedDamageCollector>();
    let timer: ReturnType<typeof setInterval> | undefined;

    const env: HubEnv = {
        collector: id => {
            let c = collectors.get(id);
            if (!c) {
                c = dcManager.value.getDualGroupedDamageCollector(
                    v => v.Id == id, v => v.TargetId, v => `${v.SkillId}`);
                collectors.set(id, c);
            }
            return c;
        },
        targetId: () => selectedTargetId.value,
        actorName: id => prettyEntityName(actorManager.value.entityMap[id], raceNameMap) ?? id,
        skillName: id => skillNameMap.value[id] || `unknownSkill:${id}`,
    };

    function push(id: string, force: boolean) {
        const w = wins.get(id);
        if (!w) return;
        try {
            for (const p of providers) {
                const inputs = p(w.spec, w.opts, env);
                if (!inputs) continue;
                const version = hash(inputs.key);
                if (!force && version === w.version) return;
                w.version = version;
                const msg: ChartData = { id, title: inputs.title, version, payload: inputs.build() };
                chartEmit(EV.data, msg);
                return;
            }
        } catch (e) {
            console.error('chartHub: compute failed for', id, e);
        }
    }

    const currentRange = () => (timeRangeMin.value !== null && timeRangeMax.value !== null
        ? { min: timeRangeMin.value, max: timeRangeMax.value } : null);
    // One watch over both refs: setTimeRange writes them together and must not emit a transient null.
    // Charts apply only null, so there is no echo loop.
    const stopRangeWatch = watch([timeRangeMin, timeRangeMax], () => { chartEmit(EV.rangeSync, currentRange()); });

    function tick() {
        for (const id of wins.keys()) push(id, false);
    }

    function release() {
        const used = new Set([...wins.values()].map(w => (w.spec as { attackerId: string }).attackerId));
        for (const [id, c] of collectors) {
            if (used.has(id)) continue;
            dcManager.value.removeDamageCollector(c as DamageCollectorBase);
            collectors.delete(id);
        }
    }

    function drop(id: string) {
        wins.delete(id);
        release();
        if (wins.size === 0 && timer !== undefined) { clearInterval(timer); timer = undefined; }
    }

    const offs = await Promise.all([
        chartOn(EV.hello, raw => {
            if (!isObj(raw) || typeof raw.id !== 'string' || !isObj(raw.spec) || typeof raw.spec.kind !== 'string'
                || typeof raw.spec.attackerId !== 'string') return;
            wins.set(raw.id, { spec: raw.spec as unknown as ChartSpec, opts: isObj(raw.opts) ? raw.opts as ChartOpts : {} });
            timer ??= setInterval(tick, HUB_INTERVAL_MS);
            push(raw.id, true);
            // A window opened while a range is set must start with it, or a later clear cannot unzoom it.
            chartEmit(EV.rangeSync, currentRange());
        }),
        chartOn(EV.closed, raw => {
            if (isObj(raw) && typeof raw.id === 'string') drop(raw.id);
        }),
        // A chart that bound to another hub after an unaddressed hello: forget it here.
        chartOn(EV.unbind, raw => {
            if (isObj(raw) && typeof raw.id === 'string' && raw.keep !== chartHubId) drop(raw.id);
        }),
        chartOn(EV.range, raw => {
            if (raw === null || raw === undefined) { clearTimeRange(); return; }
            if (isObj(raw) && Number.isFinite(raw.min) && Number.isFinite(raw.max)) {
                setTimeRange(raw.min as number, raw.max as number);
            }
        }),
    ]);
    chartEmit(EV.mainReady);

    // Tell bound charts this page is going away so they can rebind; a bfcache
    // restore announces again.
    const bye = () => chartEmit(EV.hubBye);
    const back = (e: PageTransitionEvent) => { if (e.persisted) chartEmit(EV.mainReady); };
    // Charts treat a long silence from their hub as a crash; the beat is cheap.
    let beat: ReturnType<typeof setInterval> | undefined;
    if (!isDesktop()) {
        window.addEventListener('pagehide', bye);
        window.addEventListener('pageshow', back);
        beat = setInterval(() => chartEmit(EV.hubBeat), HUB_BEAT_MS);
    }

    return () => {
        clearInterval(beat);
        if (!isDesktop()) {
            window.removeEventListener('pagehide', bye);
            window.removeEventListener('pageshow', back);
        }
        for (const off of offs) off?.();
        stopRangeWatch();
        if (timer !== undefined) clearInterval(timer);
        timer = undefined;
        wins.clear();
        release();
    };
}

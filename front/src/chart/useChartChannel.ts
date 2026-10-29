import { onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { chartEmit, chartInstanceId, chartOn } from '@/lib/chartTransport';
import { isDesktop } from '@/lib/runtimeEnv';
import { EV, type ChartData, type ChartOpts, type ChartSpec } from '@/lib/chartProtocol';

/**
 * The chart window's side of the protocol: hello on start, on option change and
 * on main-ready; keeps only chart:data addressed to this window's id.
 */
export function useChartChannel(pageId: string, spec: ChartSpec) {
    // Browser tabs register per instance; desktop windows keep their own id.
    const id = (!isDesktop() && chartInstanceId) || pageId;
    const data = shallowRef<ChartData | null>(null);
    const range = shallowRef<{ min: number; max: number } | null>(null);
    const opts = ref<ChartOpts>({});
    const offs: ((() => void) | undefined)[] = [];
    let alive = true;

    const hello = () => chartEmit(EV.hello, { id, spec, opts: opts.value });

    void Promise.all([
        chartOn(EV.data, raw => {
            const d = raw as ChartData | null;
            if (d && d.id === id) data.value = d;
        }),
        chartOn(EV.rangeSync, raw => {
            const r = raw as { min: number; max: number } | null;
            range.value = r ? { min: r.min, max: r.max } : null;
        }),
        chartOn(EV.mainReady, () => { hello(); }),
    ]).then(list => {
        if (!alive) { list.forEach(off => off?.()); return; }
        offs.push(...list);
        hello();
    });

    watch(opts, () => {
        hello();
    }, { deep: true });

    // Wails tells the hub when a chart window closes; a browser tab must say so itself.
    const bye = () => chartEmit(EV.closed, { id });
    // A bfcache restore keeps the page alive after pagehide, so it must register again.
    const back = (e: PageTransitionEvent) => { if (e.persisted) hello(); };
    if (!isDesktop()) {
        window.addEventListener('pagehide', bye);
        window.addEventListener('pageshow', back);
    }

    onBeforeUnmount(() => {
        alive = false;
        offs.forEach(off => off?.());
        window.removeEventListener('pagehide', bye);
        window.removeEventListener('pageshow', back);
    });

    return {
        data,
        range,
        opts,
        setOpts: (patch: Partial<ChartOpts>) => { opts.value = { ...opts.value, ...patch }; },
        sendRange: (r: { min: number; max: number } | null) => { chartEmit(EV.range, r); },
    };
}

// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { reactive, nextTick } from 'vue';
import { mount as vmount, VueWrapper } from '@vue/test-utils';

// happy-dom has no canvas, so echarts is mocked out entirely.
const handlers: Record<string, (e?: never) => void> = {};
const fake = {
    setOption: vi.fn(), dispatchAction: vi.fn(), resize: vi.fn(), dispose: vi.fn(), group: '',
    on: vi.fn((name: string, fn: (e?: never) => void) => { handlers[name] = fn; }),
    getOption: vi.fn(() => ({ dataZoom: [{ start: 10, end: 50, startValue: 1000, endValue: 5000 }] })),
};
vi.mock('echarts/core', () => ({ use: vi.fn(), init: () => fake, connect: vi.fn() }));
vi.mock('echarts/charts', () => ({ BarChart: {}, CustomChart: {}, LineChart: {} }));
vi.mock('echarts/components', () => ({
    AxisPointerComponent: {}, DataZoomComponent: {}, GridComponent: {}, LegendComponent: {},
    GraphicComponent: {}, MarkAreaComponent: {}, MarkLineComponent: {}, TitleComponent: {}, ToolboxComponent: {}, TooltipComponent: {},
}));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

import DpsTimeline from './DpsTimeline.vue';
import { chartView } from './chartView';
import {
    setTrackedCCIds, setSelfTrackedCCIds, setChartHiddenCCIds, setSelfChartHiddenCCIds, trackedCCIds, selfTrackedCCIds,
    chartHiddenCCIds, selfChartHiddenCCIds,
} from './ccSettings';
import * as store from '@/store';
import { actorManager, clearTimeRange, setTimeRange, timeRangeMin, timeRangeMax } from '@/store';

const dmg = (At: number, Damage = 10) => ({ At, Damage, TargetId: 't' }) as never;
const props = { entities: [{ name: 'A', damages: [dmg(100), dmg(130)] }], target: null, partyActors: [] };

const mounted: VueWrapper[] = [];
const mount = ((...a: Parameters<typeof vmount>) => { const w = vmount(...a); mounted.push(w); return w; }) as typeof vmount;
beforeEach(() => {
    vi.clearAllMocks();
    clearTimeRange();
    chartView.collapsed.value = false;
    chartView.legend = { '隊伍總和': false, '無敵': true };
});
afterEach(() => {
    while (mounted.length) mounted.pop()!.unmount();
    const am = actorManager.value;
    am.ownerHistory.length = 0;
    for (const k of Object.keys(am.entityMap)) delete am.entityMap[k];
});

const cond = (CCId: number, At: number) => ({ Id: 'x', At, CCId, DisableAt: 0, AttackerId: '', Params: {} });
const actor = (id: string, name: string, conditionHistory: unknown[] = []) =>
    ({ id, name, raceId: 8001, isPC: true, conditionHistory, casts: [], lifeHistory: [], downAt: null }) as never;
const lastOption = () => fake.setOption.mock.calls.at(-1)![0] as {
    series: { id: string; name: string; markArea?: { data: { xAxis: number }[][] } }[];
    graphic: { style?: { text: string } }[];
};

describe('DpsTimeline', () => {
    it('rebuilds when the target gains a life sample, a condition state or a downAt without new damage', async () => {
        vi.useFakeTimers();
        try {
            const target = reactive({
                id: 't', name: 'T', raceId: 8001, isPC: false, conditionHistory: [] as unknown[],
                casts: [], lifeHistory: [] as { At: number; Life: number }[], downAt: null as number | null,
            });
            mount(DpsTimeline, { props: { ...props, target: target as never } });
            const builds = () => fake.setOption.mock.calls.length;
            let n = builds();
            for (const change of [
                () => target.lifeHistory.push({ At: 110, Life: 5 }),
                () => target.conditionHistory.push({ At: 115, List: [] }),
                () => { target.downAt = 120; },
            ]) {
                change();
                await nextTick();
                vi.advanceTimersByTime(300);
                await nextTick();
                expect(builds()).toBeGreaterThan(n);
                n = builds();
            }
        } finally { vi.useRealTimers(); }
    });

    it('renders nothing without damage', () => {
        const w = mount(DpsTimeline, { props: { ...props, entities: [] } });
        expect(w.find('.dps-timeline').exists()).toBe(false);
    });

    it('collapses to a title bar and expands again', async () => {
        const w = mount(DpsTimeline, { props });
        expect(w.find('.collapsed-title').exists()).toBe(false);
        await w.get('[data-collapse]').trigger('click');
        expect(w.find('.collapsed-title').exists()).toBe(true);
        expect(chartView.collapsed.value).toBe(true);
        await w.get('[data-collapse]').trigger('click');
        expect(w.find('.collapsed-title').exists()).toBe(false);
        expect(chartView.collapsed.value).toBe(false);
    });

    it('builds a chart option from the entities', () => {
        mount(DpsTimeline, { props });
        const opt = fake.setOption.mock.calls[0][0] as { series: { name: string }[] };
        expect(opt.series[0].name).toBe('A');
    });

    it('turns a zoom range into an absolute time filter, and a reset into a clear', () => {
        const w = mount(DpsTimeline, { props });
        handlers.datazoom();
        expect([timeRangeMin.value, timeRangeMax.value]).toEqual([101, 105]);
        fake.getOption.mockReturnValueOnce({ dataZoom: [{ start: 0, end: 100 }] } as never);
        handlers.datazoom();
        expect([timeRangeMin.value, timeRangeMax.value]).toEqual([null, null]);
        w.unmount();
    });

    it('resets its zoom without re-emitting when the range is cleared from outside', async () => {
        const w = mount(DpsTimeline, { props });
        setTimeRange(101, 105);
        await w.vm.$nextTick();
        fake.dispatchAction.mockClear();
        fake.dispatchAction.mockImplementation(() => handlers.datazoom());
        clearTimeRange();
        await w.vm.$nextTick();
        expect(fake.dispatchAction).toHaveBeenCalledWith({ type: 'dataZoom', start: 0, end: 100 });
        // Still cleared: the silent dispatch did not feed a range back into the store.
        expect([timeRangeMin.value, timeRangeMax.value]).toEqual([null, null]);
        fake.dispatchAction.mockReset();
    });

    describe('self lanes', () => {
        const seed = () => {
            const am = actorManager.value;
            am.ownerHistory.push({ At: 50, Id: 'a' }, { At: 500, Id: 'b' });
            am.entityMap.a = actor('a', 'Alice', [{ At: 90, List: [cond(516, 90)] }]);
            am.entityMap.b = actor('b', 'Bob', [{ At: 90, List: [cond(476, 90)] }]);
        };

        it('builds self lanes from the owner at the fight start', () => {
            seed();
            mount(DpsTimeline, { props });
            const o = lastOption();
            const ids = o.series.map(s => s.id);
            expect(ids).toContain('lane:self:516');
            expect(ids).not.toContain('lane:self:476');
            expect(JSON.stringify(o.graphic)).toContain(JSON.stringify('自\n身').slice(1, -1));
        });

        it('labels both groups when the 自身 group has no lanes but shows its ＋', () => {
            const am = actorManager.value;
            am.ownerHistory.push({ At: 50, Id: 'a' });
            am.entityMap.a = actor('a', 'Alice', [{ At: 90, List: [cond(516, 90)] }]);
            const prev = selfTrackedCCIds.value;
            const prevB = trackedCCIds.value;
            setSelfTrackedCCIds([]);
            setTrackedCCIds([494]);
            try {
                mount(DpsTimeline, { props: { ...props, target: actor('t', 'Boss', [{ At: 105, List: [cond(494, 105)] }]) } });
                const texts = lastOption().graphic.map(g => g.style?.text);
                expect(texts).toContain('BOSS');
                expect(texts).toContain('自\n身');
            } finally { setSelfTrackedCCIds(prev); setTrackedCCIds(prevB); }
        });

        it('shows no self section without an owner', () => {
            actorManager.value.entityMap.a = actor('a', 'Alice', [{ At: 90, List: [cond(516, 90)] }]);
            mount(DpsTimeline, { props });
            expect(lastOption().series.some(s => s.id.startsWith('lane:self:'))).toBe(false);
            expect(JSON.stringify(lastOption().graphic ?? [])).not.toContain('自己');
            expect(fake.setOption.mock.calls.length).toBeGreaterThan(0);
        });

        it('passes invincible spans in ms since the fight start', () => {
            const t = actor('t', 'Boss', [{ At: 110, List: [cond(494, 110)] }, { At: 125, List: [] }]);
            mount(DpsTimeline, { props: { ...props, target: t } });
            const inv = lastOption().series.find(s => s.id === 'invincible')!;
            expect(inv.markArea!.data.map(p => [p[0].xAxis, p[1].xAxis])).toEqual([[10000, 25000]]);
        });
    });

    describe('＋ add tracked CC', () => {
        const states = (...ids: number[]) => [{ At: 105, List: ids.map(i => cond(i, 105)) }];
        const pops = () => document.body.querySelectorAll('.cc-pop');
        const picks = () => [...document.body.querySelectorAll('.cc-pop .cc-btn')].map(b => b.getAttribute('title') ?? '');
        let savedT: number[]; let savedS: number[];
        beforeEach(() => { savedT = trackedCCIds.value; savedS = selfTrackedCCIds.value; setTrackedCCIds([494]); setSelfTrackedCCIds([]); });
        afterEach(() => { setTrackedCCIds(savedT); setSelfTrackedCCIds(savedS); document.body.innerHTML = ''; });

        it('offers seen, untracked BOSS CCs and adds the pick to trackedCCIds', async () => {
            const t = actor('t', 'Boss', states(494, 500, 501));
            const w = mount(DpsTimeline, { props: { ...props, target: t }, attachTo: document.body });
            await w.get('[data-plus="boss"]').trigger('click');
            expect(pops().length).toBe(1);
            expect(picks().some(x => x.includes('494'))).toBe(false);
            expect(picks().filter(x => /50[01]/.test(x)).length).toBe(2);
            await document.body.querySelector<HTMLButtonElement>('.cc-pop .cc-btn')!.click();
            await nextTick();
            expect(trackedCCIds.value).toEqual([494, 500]);
            expect(selfTrackedCCIds.value).toEqual([]);
        });

        it('adds to the self list from the self group, and is shown with zero lanes', async () => {
            const am = actorManager.value;
            am.ownerHistory.push({ At: 50, Id: 'a' });
            am.entityMap.a = actor('a', 'Alice', states(516));
            const w = mount(DpsTimeline, { props: { ...props, target: actor('t', 'Boss') }, attachTo: document.body });
            expect(w.find('[data-plus="boss"]').exists()).toBe(true);
            await w.get('[data-plus="self"]').trigger('click');
            document.body.querySelector<HTMLButtonElement>('.cc-pop .cc-btn')!.click();
            await nextTick();
            expect(selfTrackedCCIds.value).toEqual([516]);
            expect(trackedCCIds.value).toEqual([494]);
        });

        it('marks the ＋ buttons and the popover to be skipped by screenshots', async () => {
            const w = mount(DpsTimeline, { props: { ...props, target: actor('t', 'Boss', states(500)) }, attachTo: document.body });
            expect(w.get('[data-plus="boss"]').attributes('data-html2canvas-ignore')).toBeDefined();
            await w.get('[data-plus="boss"]').trigger('click');
            expect(document.body.querySelector('.cc-pop')!.hasAttribute('data-html2canvas-ignore')).toBe(true);
        });

        it('adds a coverage-only CC from the strip ＋: tracked and chart-hidden', async () => {
            const savedH = chartHiddenCCIds.value;
            try {
                setChartHiddenCCIds(new Set());
                const t = actor('t', 'Boss', states(494, 500));
                const w = mount(DpsTimeline, { props: { ...props, target: t }, attachTo: document.body });
                await w.get('[data-strip-plus="boss"]').trigger('click');
                expect(document.body.querySelector('.cc-pop')!.hasAttribute('data-html2canvas-ignore')).toBe(true);
                document.body.querySelector<HTMLButtonElement>('.cc-pop .cc-btn')!.click();
                await nextTick();
                expect(trackedCCIds.value).toEqual([494, 500]);
                expect(chartHiddenCCIds.value.has(500)).toBe(true);
                expect(document.body.querySelector('.cc-pop')).toBeNull();
            } finally { setChartHiddenCCIds(savedH); }
        });

        it('adds a coverage-only CC to the self list from the self strip ＋', async () => {
            const savedSH = selfChartHiddenCCIds.value;
            try {
                setSelfChartHiddenCCIds(new Set());
                setSelfTrackedCCIds([516]);
                const am = actorManager.value;
                am.ownerHistory.push({ At: 50, Id: 'a' });
                am.entityMap.a = actor('a', 'Alice', states(516, 517));
                const w = mount(DpsTimeline, { props: { ...props, target: actor('t', 'Boss') }, attachTo: document.body });
                await w.get('[data-strip-plus="self"]').trigger('click');
                document.body.querySelector<HTMLButtonElement>('.cc-pop .cc-btn')!.click();
                await nextTick();
                expect(selfTrackedCCIds.value).toEqual([516, 517]);
                expect(selfChartHiddenCCIds.value.has(517)).toBe(true);
            } finally { setSelfChartHiddenCCIds(savedSH); }
        });

        it('un-hides the CC on the chart when it is added', async () => {
            const savedH = chartHiddenCCIds.value;
            const savedSH = selfChartHiddenCCIds.value;
            try {
                setChartHiddenCCIds(new Set([500]));
                const am = actorManager.value;
                am.ownerHistory.push({ At: 50, Id: 'a' });
                am.entityMap.a = actor('a', 'Alice', states(516));
                setSelfChartHiddenCCIds(new Set([516]));
                const w = mount(DpsTimeline, { props: { ...props, target: actor('t', 'Boss', states(500)) }, attachTo: document.body });
                await w.get('[data-plus="boss"]').trigger('click');
                document.body.querySelector<HTMLButtonElement>('.cc-pop .cc-btn')!.click();
                await nextTick();
                expect(trackedCCIds.value).toEqual([494, 500]);
                expect(chartHiddenCCIds.value.has(500)).toBe(false);

                await w.get('[data-plus="self"]').trigger('click');
                document.body.querySelector<HTMLButtonElement>('.cc-pop .cc-btn')!.click();
                await nextTick();
                expect(selfTrackedCCIds.value).toEqual([516]);
                expect(selfChartHiddenCCIds.value.has(516)).toBe(false);
            } finally { setChartHiddenCCIds(savedH); setSelfChartHiddenCCIds(savedSH); }
        });

        it('stays open through the scroll a focus change causes, but a later page scroll closes it', async () => {
            const w = mount(DpsTimeline, { props: { ...props, target: actor('t', 'Boss', states(500)) }, attachTo: document.body });
            const btn = w.get('[data-plus="boss"]');
            await btn.trigger('pointerdown');
            await btn.trigger('click');
            expect(pops().length).toBe(1);
            document.body.dispatchEvent(new Event('scroll'));
            await nextTick();
            expect(pops().length).toBe(1);
            await new Promise<void>(r => requestAnimationFrame(() => r()));
            // Scrolling inside the popover never strands it.
            document.body.querySelector('.cc-pop')!.dispatchEvent(new Event('scroll'));
            await nextTick();
            expect(pops().length).toBe(1);
            document.body.dispatchEvent(new Event('scroll'));
            await nextTick();
            expect(pops().length).toBe(0);
        });

        it('closes on Esc and on an outside pointerdown, one popover at a time', async () => {
            const w = mount(DpsTimeline, { props: { ...props, target: actor('t', 'Boss', states(500)) }, attachTo: document.body });
            await w.get('[data-plus="boss"]').trigger('click');
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
            await nextTick();
            expect(pops().length).toBe(0);
            await w.get('[data-plus="boss"]').trigger('click');
            expect(pops().length).toBe(1);
            document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
            await nextTick();
            expect(pops().length).toBe(0);
        });

        it('closes on collapse, window scroll (capture) and resize', async () => {
            const w = mount(DpsTimeline, { props: { ...props, target: actor('t', 'Boss', states(500)) }, attachTo: document.body });
            const open = async () => { await w.get('[data-plus="boss"]').trigger('click'); expect(pops().length).toBe(1); };
            await open();
            await w.get('[data-collapse]').trigger('click');
            expect(pops().length).toBe(0);
            await w.get('[data-collapse]').trigger('click');
            expect(pops().length).toBe(0);
            await open();
            await new Promise<void>(r => requestAnimationFrame(() => r()));
            document.body.dispatchEvent(new Event('scroll'));
            await nextTick();
            expect(pops().length).toBe(0);
            await open();
            window.dispatchEvent(new Event('resize'));
            await nextTick();
            expect(pops().length).toBe(0);
        });
    });
});

describe('DpsTimeline spacing and legend memory', () => {
    it('uses the tight card gap above the player list', async () => {
        const src = (await import('./DpsTimeline.vue?raw')).default as string;
        expect(src).toMatch(/\.dps-timeline \{\s*margin-bottom: 0;/);
    });

    it('keeps only the party and 無敵 toggles', async () => {
        mount(DpsTimeline, { props });
        await nextTick();
        handlers.legendselectchanged?.({ selected: { A: false, 隊伍總和: true, 無敵: false } } as never);
        expect(chartView.legend).toEqual({ 隊伍總和: true, 無敵: false });
        handlers.legendselectchanged?.({ selected: { A: false, 隊伍總和: true } } as never);
        expect(chartView.legend).toEqual({ 隊伍總和: true, 無敵: true });
    });

    it('remembers the legend selection across rebuilds', async () => {
        const w = mount(DpsTimeline, { props });
        await nextTick();
        handlers.legendselectchanged?.({ selected: { A: true, 隊伍總和: true } } as never);
        await nextTick();
        const opt = w.findComponent({ name: 'EChart' }).props('option') as { legend: { selected: Record<string, boolean> } };
        expect(opt.legend.selected['隊伍總和']).toBe(true);
    });
});

describe('DpsTimeline review fixes', () => {
    const states = (...ids: number[]) => [{ At: 105, List: ids.map(i => cond(i, 105)) }];
    const bossActor = () => ({
        id: 't', name: 'Boss', raceId: 8001, isPC: false, conditionHistory: [], casts: [], deathHistory: [],
        lifeHistory: [{ At: 100, Life: 990 }, { At: 130, Life: 980 }], downAt: null, maxLife: 1000,
        lifeAt: () => 980,
    }) as never;
    type Opt = { hpAt?: unknown; series: { id: string; data?: [number, number][] }[]; tooltip: { formatter: (p: unknown) => string } };

    it('shows the boss HP in the tooltip even when no 5% step is crossed', () => {
        const spy = vi.spyOn(store, 'isBossRace').mockReturnValue(true);
        mount(DpsTimeline, { props: { ...props, target: bossActor() } });
        const o = lastOption() as unknown as Opt;
        const html = o.tooltip.formatter([{ seriesId: 'dps:0', seriesName: 'A', marker: '', value: [0, 5], axisValue: 0 }]);
        expect(html).toContain('BOSS 血量');
        expect(o.series.some(x => x.id.startsWith('hpRuler'))).toBe(false);
        spy.mockRestore();
    });

    it('computes the party line from all hits combined, not per-player sums', () => {
        const entities = [
            { name: 'A', damages: [dmg(100), dmg(101)] },
            { name: 'B', damages: [dmg(100), dmg(120)] },
        ];
        mount(DpsTimeline, { props: { ...props, entities, target: null } });
        const o = lastOption() as unknown as Opt;
        const party = o.series.find(x => x.id === 'party')!.data!;
        // Beyond A's last hit (101) the party line still carries B's hit at 120.
        expect(party.some(([ms, v]) => ms >= 15000 && v > 0)).toBe(true);
        expect(o.series.map(x => x.id).slice(0, 3)).toEqual(['dps:0', 'dps:1', 'party']);
    });

    it('titles the popover 僅覆蓋率 and splits aria-expanded between chart and strip ＋', async () => {
        const w = mount(DpsTimeline, { props: { ...props, target: actor('t', 'Boss', states(500)) }, attachTo: document.body });
        await w.get('[data-strip-plus="boss"]').trigger('click');
        expect(document.body.querySelector('.pop-title')!.textContent).toBe('BOSS 身上出現過（僅覆蓋率）');
        expect(w.get('[data-plus="boss"]').attributes('aria-expanded')).toBe('false');
        expect(w.get('[data-strip-plus="boss"]').attributes('aria-expanded')).toBe('true');
        await w.get('[data-strip-plus="boss"]').trigger('click');
        await w.get('[data-plus="boss"]').trigger('click');
        expect(document.body.querySelector('.pop-title')!.textContent).toBe('BOSS 身上出現過');
        expect(w.get('[data-plus="boss"]').attributes('aria-expanded')).toBe('true');
        expect(w.get('[data-strip-plus="boss"]').attributes('aria-expanded')).toBe('false');
    });
});


describe('DpsTimeline help', () => {
    it('lists the hidden interactions in a help icon, gone when collapsed', async () => {
        const w = mount(DpsTimeline, { props, attachTo: document.body });
        const tip = w.get('[data-chart-help]').attributes('title')!;
        for (const s of ['Ctrl＋滾輪', '右鍵', '拖曳', '＋', '全部命中']) expect(tip).toContain(s);
        await w.get('[data-collapse] button').trigger('click');
        expect(w.find('[data-chart-help]').exists()).toBe(false);
        await w.get('[data-collapse] button').trigger('click');
    });
});

describe('DpsTimeline lane and coverage icons', () => {
    const hist = [{ At: 105, List: [cond(494, 105), cond(803, 105), cond(1026, 105)] }];
    let prev: { t: number[]; h: Set<number> };
    beforeEach(() => {
        prev = { t: trackedCCIds.value, h: chartHiddenCCIds.value };
        setTrackedCCIds([494, 803, 1026, 777]);
        setChartHiddenCCIds(new Set([777]));
    });
    afterEach(() => { setTrackedCCIds(prev.t); setChartHiddenCCIds(prev.h); });
    const drag = async (from: Element, to: Element) => {
        from.dispatchEvent(new Event('dragstart', { bubbles: true }));
        to.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
        to.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }));
        from.dispatchEvent(new Event('dragend', { bubbles: true }));
        await nextTick();
    };

    it('puts a hit box on each lane icon at the lane top', () => {
        const w = mount(DpsTimeline, { props: { ...props, target: actor('t', 'Boss', hist) }, attachTo: document.body });
        const hits = w.findAll('[data-lane-cc]');
        expect(hits.map(h => h.attributes('data-lane-cc'))).toEqual(['494', '803', '1026']);
        const tops = hits.map(h => parseFloat((h.element as HTMLElement).style.top));
        expect(tops[1] - tops[0]).toBe(tops[2] - tops[1]);
    });

    it('right-clicking a lane icon opens the CC menu; dropping one lane on another reorders', async () => {
        const w = mount(DpsTimeline, { props: { ...props, target: actor('t', 'Boss', hist) }, attachTo: document.body });
        const { useContextMenu } = await import('../../ui/useContextMenu');
        w.get('[data-lane-cc="803"]').element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        const items = useContextMenu().state.items.flatMap(m => (m === 'divider' ? [] : [m.label]));
        expect(items).toEqual(['時間軸與覆蓋率', '僅覆蓋率', '移除']);
        useContextMenu().close();
        await drag(w.get('[data-lane-cc="1026"]').element, w.get('[data-lane-cc="494"]').element);
        expect(trackedCCIds.value).toEqual([1026, 494, 803, 777]);
    });

    it('coverage follows the selected time range', async () => {
        // Fight 100..130; 777 is on 100..115, i.e. half the fight.
        const h = [{ At: 100, List: [cond(777, 100)] }, { At: 115, List: [] }];
        const w = mount(DpsTimeline, { props: { ...props, target: actor('t', 'Boss', h) }, attachTo: document.body });
        const pct = () => w.get('[data-cov-cc="777"] .pct').text();
        expect(pct()).toBe('50.0%');
        setTimeRange(100, 110);
        await nextTick();
        expect(pct()).toBe('100%');
        setTimeRange(120, 130);
        await nextTick();
        expect(pct()).toBe('0.0%');
        clearTimeRange();
        await nextTick();
        expect(pct()).toBe('50.0%');
    });

    it('coverage cells drag within their kind only', async () => {
        const w = mount(DpsTimeline, { props: { ...props, target: actor('t', 'Boss', hist) }, attachTo: document.body });
        const cell = (id: number) => w.get(`[data-cov-cc="${id}"]`).element;
        await drag(cell(777), cell(494));
        expect(trackedCCIds.value).toEqual([494, 803, 1026, 777]);
        await drag(cell(803), cell(494));
        expect(trackedCCIds.value).toEqual([803, 494, 1026, 777]);
    });
});

// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

const handlers: Record<string, () => void> = {};
const fake = {
    setOption: vi.fn(), dispatchAction: vi.fn(), resize: vi.fn(), dispose: vi.fn(), group: '',
    on: vi.fn((name: string, fn: () => void) => { handlers[name] = fn; }),
    getOption: vi.fn(() => ({ dataZoom: [{ start: 10, end: 50, startValue: 1000, endValue: 5000 }] })),
};
const init = vi.fn((..._a: unknown[]) => fake);
const connect = vi.fn();
vi.mock('echarts/core', () => ({ use: vi.fn(), init: (...a: unknown[]) => init(...a), connect: (g: string) => connect(g) }));
vi.mock('echarts/charts', () => ({ BarChart: {}, CustomChart: {}, LineChart: {} }));
vi.mock('echarts/components', () => ({
    AxisPointerComponent: {}, DataZoomComponent: {}, GraphicComponent: {}, GridComponent: {}, LegendComponent: {},
    MarkAreaComponent: {}, MarkLineComponent: {},
    TitleComponent: {}, ToolboxComponent: {}, TooltipComponent: {},
}));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

import EChart, { zoomRangeOf } from './EChart.vue';

beforeEach(() => { vi.clearAllMocks(); fake.group = ''; });

describe('EChart', () => {
    it('inits a canvas chart, applies the option lazily and disposes on unmount', () => {
        const w = mount(EChart, { props: { option: { a: 1 } } });
        expect(init).toHaveBeenCalledWith(expect.anything(), null, { renderer: 'canvas' });
        expect(fake.setOption).toHaveBeenCalledWith({ a: 1 }, { notMerge: true, lazyUpdate: true });
        w.unmount();
        expect(fake.dispose).toHaveBeenCalled();
    });

    it('merges on option change and rebuilds when the rebuild key changes', async () => {
        const w = mount(EChart, { props: { option: { a: 1 }, rebuildKey: 'x' } });
        fake.setOption.mockClear();
        await w.setProps({ option: { a: 2 } });
        expect(fake.setOption).toHaveBeenLastCalledWith({ a: 2 }, { notMerge: false, lazyUpdate: true });
        await w.setProps({ rebuildKey: 'y' });
        expect(fake.setOption).toHaveBeenLastCalledWith({ a: 2 }, { notMerge: true, lazyUpdate: true });
    });

    it('joins a connect group', () => {
        mount(EChart, { props: { option: {}, group: 'g1' } });
        expect(fake.group).toBe('g1');
        expect(connect).toHaveBeenCalledWith('g1');
    });

    it('emits zoom for user zoom, null when back to full range', () => {
        const w = mount(EChart, { props: { option: {} } });
        handlers.datazoom();
        expect(w.emitted('zoom')![0]).toEqual([{ startMs: 1000, endMs: 5000 }]);
        fake.getOption.mockReturnValueOnce({ dataZoom: [{ start: 0, end: 100 }] } as never);
        handlers.datazoom();
        expect(w.emitted('zoom')![1]).toEqual([null]);
    });

    it('resetZoom dispatches without echoing a zoom event', async () => {
        const w = mount(EChart, { props: { option: {} } });
        fake.dispatchAction.mockImplementationOnce(() => handlers.datazoom());
        (w.vm as unknown as { resetZoom(): void }).resetZoom();
        await nextTick();
        expect(fake.dispatchAction).toHaveBeenCalledWith({ type: 'dataZoom', start: 0, end: 100 });
        expect(w.emitted('zoom')).toBeUndefined();
    });

    it('zoomRangeOf ignores half-known ranges', () => {
        expect(zoomRangeOf(undefined)).toBeNull();
        expect(zoomRangeOf({ start: 5, end: 50 })).toBeNull();
    });
});

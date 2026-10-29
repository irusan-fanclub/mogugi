// @vitest-environment happy-dom
vi.mock('@/lib/runtimeEnv', async o => ({ ...(await o<object>()), isDesktop: () => true }));
import { describe, it, expect, vi, afterEach } from 'vitest';
import { nextTick } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';

const hoisted = vi.hoisted(() => ({ resetZoom: vi.fn(), emitted: [] as { name: string; data: unknown }[] }));
vi.mock('@/lib/desktopBridge', () => ({
    onDesktopEvent: async () => () => {},
    emitDesktop: async (name: string, data?: unknown) => { hoisted.emitted.push({ name, data }); },
}));
vi.mock('@/desktop/charts/EChart.vue', async () => {
    const { defineComponent: dc } = await import('vue');
    return { default: dc({ name: 'EChartStub', props: ['option'], emits: ['zoom'], setup: (_p, { expose }) => { expose({ resetZoom: hoisted.resetZoom }); return () => null; } }) };
});

import ConditionView from './ConditionView.vue';

const payload = {
    options: [{ id: 5, name: 'Five', icon: '/icons/cc/5.png' }, { id: 7, name: 'Seven', icon: '/icons/cc/7.png' }],
    ccId: 5, total: 125, on: 25, series: [{ name: 'a', points: [[1000, 1]] }],
};
const base = { spec: { kind: 'condition' as const, attackerId: 'p1' }, opts: {}, data: { id: 'c', title: 'Five - Hero', version: 1, payload } };

let w: VueWrapper | null = null;
afterEach(() => { w?.unmount(); w = null; hoisted.emitted.length = 0; hoisted.resetZoom.mockClear(); });

describe('ConditionView', () => {
    it('shows total and ON time with a one-decimal percent', () => {
        w = mount(ConditionView, { props: base });
        expect(w.text()).toContain('Total: 02:05');
        expect(w.text()).toContain('ON: 00:25 (20.0%)');
        expect(w.find('img.icon').attributes('src')).toBe('/icons/cc/5.png');
    });


    it('unzooms silently when the main window clears the range', async () => {
        w = mount(ConditionView, { props: { ...base, range: { min: 1, max: 2 } } });
        await w.setProps({ range: null });
        await nextTick();
        expect(hoisted.resetZoom).toHaveBeenCalledTimes(1);
        expect(w.emitted('range')).toBeUndefined();
    });

    it('a zoom is sent as a seconds range and a reset as null', () => {
        w = mount(ConditionView, { props: base });
        const chart = w.findComponent({ name: 'EChartStub' });
        chart.vm.$emit('zoom', { startMs: 1000, endMs: 5000 });
        chart.vm.$emit('zoom', null);
        expect(w.emitted('range')).toEqual([[{ min: 1, max: 5 }], [null]]);
    });

    it('tells when no CC is available', () => {
        w = mount(ConditionView, { props: { ...base, data: { ...base.data, payload: { ...payload, options: [], ccId: -1, series: [] } } } });
        expect(w.text()).toContain('沒有可顯示的狀態');
    });
});

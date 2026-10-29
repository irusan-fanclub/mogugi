// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { flushPromises, mount, VueWrapper } from '@vue/test-utils';

vi.mock('@/lib/runtimeEnv', () => ({ isDesktop: () => false }));
const t = vi.hoisted(() => ({ emitted: [] as { name: string; data: unknown }[] }));
vi.mock('@/lib/chartTransport', () => ({
    chartEmit: (name: string, data?: unknown) => { t.emitted.push({ name, data }); },
    chartOn: async () => () => {},
    chartInstanceId: 'a~inst',
}));

import { useChartChannel } from './useChartChannel';

let w: VueWrapper | null = null;
afterEach(() => { w?.unmount(); w = null; t.emitted.length = 0; });

const names = () => t.emitted.map(e => e.name);

describe('useChartChannel in the browser', () => {
    it('pagehide emits closed; a persisted pageshow sends hello again', async () => {
        w = mount(defineComponent({
            setup() { useChartChannel('a', { kind: 'hitlog', attackerId: 'p1', targetId: '' }); return () => h('div'); },
        }));
        await flushPromises();
        expect(names()).toEqual(['chart:hello']);
        window.dispatchEvent(new Event('pagehide'));
        expect(t.emitted.at(-1)).toEqual({ name: 'window:closed', data: { id: 'a~inst' } });
        window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
        expect(names()).toEqual(['chart:hello', 'window:closed']);
        window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
        expect(t.emitted.at(-1)?.name).toBe('chart:hello');
        expect(names()).toHaveLength(3);
    });

    it('registers under the page instance id so a twin tab closing does not remove this one', async () => {
        w = mount(defineComponent({
            setup() { useChartChannel('a', { kind: 'hitlog', attackerId: 'p1', targetId: '' }); return () => h('div'); },
        }));
        await flushPromises();
        expect((t.emitted[0].data as { id: string }).id).toBe('a~inst');
        window.dispatchEvent(new Event('pagehide'));
        expect(t.emitted.at(-1)).toEqual({ name: 'window:closed', data: { id: 'a~inst' } });
    });
});

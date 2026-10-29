// @vitest-environment happy-dom
vi.mock('@/lib/runtimeEnv', async o => ({ ...(await o<object>()), isDesktop: () => true }));
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushPromises, mount, VueWrapper } from '@vue/test-utils';

vi.mock('@wailsio/runtime', () => ({
    Window: { Minimise: vi.fn(), ToggleMaximise: vi.fn(), Close: vi.fn(), IsMaximised: vi.fn(async () => false) },
    Events: { On: vi.fn(), Emit: vi.fn() },
    Browser: { OpenURL: vi.fn() },
}));
type Handler = (data: unknown) => void;
const bridge = vi.hoisted(() => ({ handlers: new Map<string, Handler[]>(), emitted: [] as { name: string; data: unknown }[] }));
vi.mock('@/lib/desktopBridge', () => ({
    onDesktopEvent: async (name: string, cb: Handler) => {
        bridge.handlers.set(name, [...(bridge.handlers.get(name) ?? []), cb]);
        return () => {};
    },
    emitDesktop: async (name: string, data?: unknown) => { bridge.emitted.push({ name, data }); },
}));
vi.mock('@/desktop/charts/EChart.vue', () => ({ default: { template: '<div class="echart-stub" />' } }));

import ChartApp from './ChartApp.vue';

const fire = (name: string, data: unknown) => (bridge.handlers.get(name) ?? []).forEach(h => h(data));
const hellos = () => bridge.emitted.filter(e => e.name === 'chart:hello');
let w: VueWrapper | null = null;

function mountAt(search: string) {
    history.replaceState({}, '', '/chart.html' + search);
    w = mount(ChartApp);
    return flushPromises();
}
const spec = encodeURIComponent(JSON.stringify({ kind: 'hitlog', attackerId: 'p1', targetId: '' }));

beforeEach(() => { bridge.handlers.clear(); bridge.emitted.length = 0; });
afterEach(() => { w?.unmount(); w = null; });

describe('ChartApp', () => {
    it('shows an error and sends no hello when spec is missing', async () => {
        await mountAt('?id=a&kind=hitlog');
        expect(w!.find('[data-chart-error]').text()).toContain('spec');
        expect(hellos()).toHaveLength(0);
    });

    it('shows the unsupported message for a removed chart spec', async () => {
        for (const kind of ['cumulative', 'dps', 'count', 'distribution']) {
            const old = encodeURIComponent(JSON.stringify({ kind, attackerId: 'p1' }));
            await mountAt(`?id=a&kind=${kind}&spec=${old}`);
            expect(w!.find('[data-chart-error]').text()).toContain(kind);
            w!.unmount();
        }
        w = null;
    });

    it('shows an error for malformed spec JSON', async () => {
        await mountAt('?id=a&kind=hitlog&spec=%7Bnope');
        expect(w!.find('[data-chart-error]').exists()).toBe(true);
        expect(hellos()).toHaveLength(0);
    });

    it('sends hello with empty options, waits for data, and resends on main-ready', async () => {
        await mountAt(`?id=a&kind=hitlog&title=T&spec=${spec}`);
        expect(hellos()).toHaveLength(1);
        expect(hellos()[0].data).toEqual({ id: 'a', spec: { kind: 'hitlog', attackerId: 'p1', targetId: '' }, opts: {} });
        expect(w!.text()).toContain('等待主視窗…');
        fire('chart:main-ready', undefined);
        await flushPromises();
        expect(hellos()).toHaveLength(2);
    });

    it('ignores data for other windows and shows its own', async () => {
        await mountAt(`?id=a&kind=hitlog&title=T&spec=${spec}`);
        const payload = { header: 'N', hits: [] };
        fire('chart:data', { id: 'other', title: 'X', version: 1, payload });
        await flushPromises();
        expect(w!.text()).toContain('等待主視窗…');
        fire('chart:data', { id: 'a', title: 'N -> All', version: 2, payload });
        await flushPromises();
        expect(w!.text()).not.toContain('等待主視窗…');
        expect(w!.text()).toContain('N -> All');
    });
});

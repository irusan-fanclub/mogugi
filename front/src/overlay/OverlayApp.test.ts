// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick, ref } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

type Handler = (data: unknown) => void;
const bridge = vi.hoisted(() => ({ handlers: new Map<string, Handler[]>(), emit: vi.fn() }));
vi.mock('@/lib/desktopBridge', () => ({
    onDesktopEvent: async (name: string, cb: Handler) => {
        bridge.handlers.set(name, [...(bridge.handlers.get(name) ?? []), cb]);
        return () => {};
    },
    emitDesktop: (name: string, data?: unknown) => { bridge.emit(name, data); return Promise.resolve(); },
}));
vi.mock('@/lib/backendSession', () => ({
    createBackendSession: () => ({ source: ref(null), connect: vi.fn(), close: vi.fn() }),
}));
vi.mock('@/lib/gameData', () => ({ loadNameMaps: async () => {} }));
vi.mock('@/lib/iconFallback', () => ({ installIconFallback: () => () => {} }));

import { actorManager, dcManager } from '@/store';
import OverlayApp from './OverlayApp.vue';
import { appear, hit, cc, BOSS_RACE } from './testSupport';

const fire = (name: string, data: unknown) => (bridge.handlers.get(name) ?? []).forEach(h => h(data));
const state = (locked: boolean, layout: Record<string, unknown> = {}) => ({ locked, hotkey: 'Ctrl+Alt+L', hotkeyError: '', licensed: true, elevated: true, elevateError: '', hidden: false, visibleHotkey: 'Ctrl+Alt+O', visibleHotkeyError: '', layout, gameFound: true });
let w: VueWrapper | null = null;

// happy-dom lays nothing out: the viewport and the component heights are injected.
const dom = { vw: 1280, vh: 720, ro: [] as (() => void)[] };
class FakeRO {
    constructor(cb: () => void) { dom.ro.push(cb); }
    observe() {}
    disconnect() {}
    unobserve() {}
}
const resize = async (width: number, height: number) => { dom.vw = width; dom.vh = height; dom.ro.forEach(f => f()); await nextTick(); };
const COMP_H = 100;
const sets = () => bridge.emit.mock.calls.filter(c => c[0] === 'overlay:set-layout').map(c => c[1] as { id: string; layout: Record<string, unknown> });
const comp = (id: string) => w!.find(`[data-component="${id}"]`);
const pos = (id: string) => { const st = (comp(id).element as HTMLElement).style; return [parseFloat(st.left), parseFloat(st.top)]; };
const ptr = (x: number, y: number, extra: Record<string, unknown> = {}) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, ...extra });

async function mountApp() {
    w = mount(OverlayApp, { attachTo: document.body });
    await flushPromises();
}
const tick = async (ms = 500) => { await vi.advanceTimersByTimeAsync(ms); await nextTick(); };

beforeEach(() => {
    vi.stubGlobal('ResizeObserver', FakeRO);
    dom.ro.length = 0; dom.vw = 1280; dom.vh = 720; bridge.emit.mockClear();
    const getters: [string, () => number][] = [['clientWidth', () => dom.vw], ['clientHeight', () => dom.vh], ['offsetHeight', () => COMP_H]];
    for (const [k, get] of getters) Object.defineProperty(HTMLElement.prototype, k, { configurable: true, get });
    vi.useFakeTimers();
    vi.setSystemTime(2000 * 1000);
    bridge.handlers.clear();
    actorManager.value.clear();
    dcManager.value.clear();
});
afterEach(() => { w?.unmount(); w = null; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('OverlayApp', () => {
    it('locked: components ignore the pointer and there is no editing chrome', async () => {
        await mountApp();
        fire('overlay:state', state(true));
        appear('p1', 8001, 100, 'Alice');
        hit('p1', 'm1', 1000, 100);
        fire('overlay:target', { targetId: '' });
        await tick();
        const c = comp('dps');
        expect(c.exists()).toBe(true);
        expect((c.element as HTMLElement).style.pointerEvents).toBe('none');
        expect(w!.find('[data-anchor-badge]').exists()).toBe(false);
        expect(w!.find('[data-lock]').exists()).toBe(false);
        expect(comp('cooldown').exists()).toBe(false);
    });

    it('disabled components are not drawn while locked', async () => {
        await mountApp();
        fire('overlay:state', state(true, { cc: { enabled: false, anchor: 'tl', x: 24, y: 24, width: 300, maxRows: 6 } }));
        await nextTick();
        expect(comp('cc').exists()).toBe(false);
    });

    it('unlocked: every component shows with sample data tagged', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        for (const id of ['dps', 'cc', 'cooldown', 'alerts']) {
            expect(comp(id).exists()).toBe(true);
            expect(comp(id).text()).toContain('範例');
            expect(comp(id).find('[data-anchor-badge]').exists()).toBe(true);
        }
        expect(w!.find('[data-lock]').text()).toContain('Ctrl+Alt+L');
    });

    it('dragging cc to the middle saves once, with the centre anchor', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        expect(pos('cc')).toEqual([24, 24]);
        const c = comp('cc');
        await c.trigger('pointerdown', ptr(50, 50));
        await c.trigger('pointermove', ptr(300, 200));
        await c.trigger('pointermove', ptr(512, 332));
        expect(sets()).toHaveLength(0);
        expect(w!.find('[data-guide]').exists()).toBe(true);
        expect(w!.find('[data-grid]').exists()).toBe(true);
        await c.trigger('pointerup', ptr(512, 332));
        expect(sets()).toHaveLength(1);
        expect(sets()[0].id).toBe('cc');
        expect(sets()[0].layout).toMatchObject({ anchor: 'center', x: 0, y: 0, width: 300 });
    });

    it('a released drag stays put until Go echoes the saved layout', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        const c = comp('cc');
        await c.trigger('pointerdown', ptr(50, 50));
        await c.trigger('pointermove', ptr(512, 332));
        await c.trigger('pointerup', ptr(512, 332));
        const saved = sets()[0].layout;
        const [l, t] = pos('cc');
        expect([l, t]).not.toEqual([24, 24]);
        fire('overlay:state', state(false, { cc: saved }));
        await nextTick();
        expect(pos('cc')).toEqual([l, t]);
    });

    it('a pending layout is dropped after a while if no echo arrives', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        const c = comp('cc');
        await c.trigger('pointerdown', ptr(50, 50));
        await c.trigger('pointermove', ptr(512, 332));
        await c.trigger('pointerup', ptr(512, 332));
        expect(pos('cc')).not.toEqual([24, 24]);
        await tick(2500);
        expect(pos('cc')).toEqual([24, 24]);
    });

    it('holding Alt turns snapping off', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        const c = comp('cc');
        await c.trigger('pointerdown', ptr(50, 50));
        await c.trigger('pointermove', ptr(512, 332, { altKey: true }));
        expect(w!.find('[data-guide]').exists()).toBe(false);
        await c.trigger('pointerup', ptr(512, 332, { altKey: true }));
        expect(sets()[0].layout).toMatchObject({ anchor: 'center', x: -4, y: -4 });
    });

    it('locking mid-drag ends the drag', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        const c = comp('cc');
        await c.trigger('pointerdown', ptr(50, 50));
        await c.trigger('pointermove', ptr(516, 336));
        fire('overlay:state', state(true));
        await nextTick();
        await c.trigger('pointerup', ptr(516, 336));
        expect(sets()).toHaveLength(0);
        fire('overlay:state', state(false));
        await nextTick();
        expect(w!.find('[data-guide]').exists()).toBe(false);
        expect(w!.find('[data-grid]').exists()).toBe(false);
        expect(pos('cc')).toEqual([24, 24]);
    });

    it('a cancelled pointer ends the drag without saving', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        const c = comp('cc');
        await c.trigger('pointerdown', ptr(50, 50));
        await c.trigger('pointermove', ptr(516, 336));
        await c.trigger('pointercancel', ptr(516, 336));
        expect(sets()).toHaveLength(0);
        expect(w!.find('[data-guide]').exists()).toBe(false);
        expect(pos('cc')).toEqual([24, 24]);
    });

    it('does not save on viewport resize', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        const before = pos('dps');
        await resize(1000, 500);
        expect(pos('dps')).not.toEqual(before);
        expect(pos('dps')).toEqual([1000 - 24 - 260, 24]);
        expect(sets()).toHaveLength(0);
    });

    it('a component bigger than the window is drawn clamped, never written back', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        await resize(200, 80);
        expect(pos('cc')).toEqual([0, 0]);
        expect(sets()).toHaveLength(0);
    });

    it('the anchor badge cycles the anchor without moving the component', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        const before = pos('cc');
        await comp('cc').find('[data-anchor-badge]').trigger('click');
        expect(sets()).toHaveLength(1);
        expect(sets()[0].layout).toMatchObject({ anchor: 'tr', x: 24 + 300 - 1280, y: 24 });
        expect(pos('cc')).toEqual(before);
    });

    it('cycling the anchor of a clamped component keeps the stored position', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        await resize(200, 80);
        expect(pos('cc')).toEqual([0, 0]);
        await comp('cc').find('[data-anchor-badge]').trigger('click');
        // The stored (24, 24) converted to the right anchor, not the clamped (0, 0).
        expect(sets()[0].layout).toMatchObject({ anchor: 'tr', x: 24 + 300 - 200, y: 24 });
    });

    it('dragging the width handle of a left-anchored component widens it on the right', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        const c = comp('cc');
        await c.find('[data-handle]').trigger('pointerdown', ptr(324, 70));
        await c.trigger('pointermove', ptr(374, 70, { altKey: true }));
        expect(sets()).toHaveLength(0);
        await c.trigger('pointerup', ptr(374, 70, { altKey: true }));
        expect(sets()[0].layout).toMatchObject({ anchor: 'tl', x: 24, y: 24, width: 350 });
    });

    it('width is limited to 120-800', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        const c = comp('cc');
        await c.find('[data-handle]').trigger('pointerdown', ptr(324, 70));
        await c.trigger('pointermove', ptr(-900, 70, { altKey: true }));
        await c.trigger('pointerup', ptr(-900, 70, { altKey: true }));
        expect(sets()[0].layout.width).toBe(120);
    });

    it('a right-anchored component has its handle on the left and keeps its right edge', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        const c = comp('dps');
        expect(c.find('[data-handle]').attributes('data-side')).toBe('left');
        await c.find('[data-handle]').trigger('pointerdown', ptr(1000, 70));
        await c.trigger('pointermove', ptr(960, 70, { altKey: true }));
        await c.trigger('pointerup', ptr(960, 70, { altKey: true }));
        expect(sets()[0].layout).toMatchObject({ anchor: 'tr', x: -24, width: 300 });
    });

    it('the toggle enables a disabled component', async () => {
        await mountApp();
        fire('overlay:state', state(false, { cc: { enabled: false, anchor: 'tl', x: 24, y: 24, width: 300, maxRows: 6 } }));
        await nextTick();
        await comp('cc').find('[data-toggle]').trigger('click');
        expect(sets()[0]).toMatchObject({ id: 'cc', layout: { enabled: true, anchor: 'tl' } });
    });

    it('toolbar: lock sends set-locked; reset sends the defaults and keeps enabled', async () => {
        await mountApp();
        fire('overlay:state', state(false, { cc: { enabled: false, anchor: 'br', x: -5, y: -5, width: 500, maxRows: 2 } }));
        await nextTick();
        await w!.find('[data-lock]').trigger('click');
        expect(bridge.emit).toHaveBeenCalledWith('overlay:set-locked', { locked: true });
        await w!.find('[data-reset]').trigger('click');
        const s = sets();
        expect(s.map(x => x.id)).toEqual(['dps', 'cc', 'cooldown', 'alerts']);
        expect(s[1].layout).toEqual({ enabled: false, anchor: 'tl', x: 24, y: 24, width: 300, maxRows: 8 });
        expect(s[0].layout).toMatchObject({ enabled: true, anchor: 'tr' });
    });

    it('dps rows honour the column settings', async () => {
        await mountApp();
        fire('overlay:state', state(true));
        appear('p1', 8001, 100, 'Alice');
        hit('p1', 'm1', 1000, 100);
        hit('p1', 'm1', 1010, 100);
        fire('overlay:target', { targetId: '' });
        await tick();
        expect(w!.find('[data-row]').text()).toContain('Alice');
        expect(w!.findAll('[data-col]').map(c => c.attributes('data-col'))).toEqual(['dps', 'share']);
        fire('overlay:settings', { dps: { columns: { dps: false, total: false, share: false } } });
        await nextTick();
        expect(w!.findAll('[data-col]')).toHaveLength(0);
    });

    it('cc icon gets the expiring class near its end', async () => {
        await mountApp();
        fire('overlay:state', state(true));
        appear('p1', 8001, 100, 'Alice');
        appear('b1', BOSS_RACE, 100);
        const now = Date.now() / 1000;
        cc('b1', 4, now - 5, now + 2);
        cc('b1', 5, now - 5, now + 60);
        fire('overlay:settings', { cc: { sections: { boss: [4, 5], self: [], party: [] } } });
        fire('overlay:target', { targetId: 'b1' });
        await tick(250);
        const icons = w!.findAll('[data-icon]');
        expect(icons.map(i => i.classes().includes('expiring'))).toEqual([true, false]);
    });
});

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
const session = vi.hoisted(() => ({
    inDungeon: null as unknown as { value: boolean },
    source: null as unknown as { value: { Mode: string } | null },
}));
vi.mock('@/lib/backendSession', () => ({
    createBackendSession: () => {
        session.inDungeon = ref(false);
        session.source = ref(null);
        return { source: session.source, connect: vi.fn(), close: vi.fn(), inDungeon: session.inDungeon };
    },
}));
vi.mock('@/lib/gameData', () => ({ loadNameMaps: async () => {} }));
vi.mock('@/lib/iconFallback', () => ({ installIconFallback: () => () => {} }));

import { actorManager, condNameMap, dcManager } from '@/store';
import type { eventBase } from '@/protocols';
import OverlayApp from './OverlayApp.vue';
import { appear, hit, cc, BOSS_RACE } from './testSupport';

const fire = (name: string, data: unknown) => {
    (bridge.handlers.get(name) ?? []).forEach(h => h(data));
};
// The shipped defaults changed; the tests keep the layout they were written against as stored state.
const L = (anchor: string, x: number, y: number, width: number, maxRows: number, dock?: string) =>
    ({ enabled: true, anchor, x, y, width, maxRows, ...(dock ? { dock } : {}) });
const BASE_LAYOUT: Record<string, unknown> = {
    dps: L('tr', -24, 24, 260, 8), ccBoss: L('tl', 24, 24, 300, 1), ccSelf: L('tl', 0, 0, 300, 1, 'ccBoss'),
    ccParty: L('tl', 0, 0, 300, 1, 'ccSelf'), cooldown: L('tl', 340, 24, 140, 3), burst: L('center', 0, -70, 120, 1),
    misc: L('center', 0, 100, 120, 1), alerts: L('center', 0, -170, 320, 4),
};
const state = (locked: boolean, layout: Record<string, unknown> = {}) => ({ locked, hotkey: 'Ctrl+Alt+L', hotkeyError: '', licensed: true, elevated: true, elevateError: '', hidden: false, visibleHotkey: 'Ctrl+Alt+O', visibleHotkeyError: '', layout: { ...BASE_LAYOUT, ...layout }, gameFound: true });
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
const removes = () => bridge.emit.mock.calls.filter(c => c[0] === 'overlay:remove-layout').map(c => (c[1] as { id: string }).id);
const comp = (id: string) => w!.find(`[data-component="${id}"]`);
const tileKeys = (id: string) => comp(id).findAll('[data-tile-key]').map(t => t.attributes('data-tile-key'));
const UNIT = { enabled: true, anchor: 'tl', x: 600, y: 400, width: 120, maxRows: 1 };
// A boss the overlay watches: present, alive, with a hit on it.
const boss = () => { appear('p1', 8001, 100, 'Alice'); appear('b1', BOSS_RACE, 100); hit('p1', 'b1', 1000, 100); };
const pos = (id: string) => { const st = (comp(id).element as HTMLElement).style; return [parseFloat(st.left), parseFloat(st.top)]; };
const ptr = (x: number, y: number, extra: Record<string, unknown> = {}) => ({ clientX: x, clientY: y, pointerId: 1, button: 0, ...extra });

async function mountApp() {
    w = mount(OverlayApp, { attachTo: document.body });
    await flushPromises();
    fire('overlay:settings', {});
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
    // clear() keeps the entities; a boss left from another test would count as present.
    for (const k of Object.keys(actorManager.value.entityMap)) delete actorManager.value.entityMap[k];
    dcManager.value.clear();
    condNameMap.value = {};
});
afterEach(() => { w?.unmount(); w = null; vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('OverlayApp', () => {
    it('locked: components ignore the pointer and there is no editing chrome', async () => {
        await mountApp();
        fire('overlay:state', state(true));
        boss();
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
        fire('overlay:state', state(true, { ccBoss: { enabled: false, anchor: 'tl', x: 24, y: 24, width: 300, maxRows: 6 } }));
        boss();
        await tick();
        expect(comp('dps').exists()).toBe(true);
        expect(comp('ccBoss').exists()).toBe(false);
    });

    it('unlocked: every section shows with sample data tagged', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        for (const id of ['dps', 'ccBoss', 'ccSelf', 'ccParty', 'cooldown', 'burst', 'alerts']) {
            expect(comp(id).exists()).toBe(true);
            expect(comp(id).text()).toContain('範例');
            const docked = ['ccSelf', 'ccParty'].includes(id);
            expect(comp(id).find(docked ? '[data-undock]' : '[data-anchor-badge]').exists()).toBe(true);
        }
        expect(comp('dps').text()).toContain('簡易戰鬥資訊');
        expect(w!.find('[data-lock]').text()).toContain('Ctrl+Alt+L');
    });

    it('a replay source draws no frame while locked; back to live draws again', async () => {
        await mountApp();
        fire('overlay:state', state(true));
        boss();
        session.inDungeon.value = true;
        appear('me', 8001, 100, 'Me');
        actorManager.value.onEvent({ EventId: 14, At: 100, Id: 'me', Name: 'Me' } as unknown as eventBase);
        await tick();
        expect(comp('dps').exists()).toBe(true);
        session.source.value = { Mode: 'replay' };
        await tick();
        expect(w!.findAll('[data-component]')).toHaveLength(0);
        session.source.value = { Mode: 'live' };
        await tick();
        expect(comp('dps').exists()).toBe(true);
    });

    it('a replay source still shows the sample frames while editing', async () => {
        await mountApp();
        session.source.value = { Mode: 'replay' };
        boss();
        fire('overlay:state', state(false));
        await tick();
        expect(comp('dps').text()).toContain('範例');
        expect(tileKeys('ccBoss')).toEqual(['1164', '1165', '1166', '323']);
    });

    it('unlocked with no data: the BOSS CC frame shows a sample tile per item', async () => {
        await mountApp();
        fire('overlay:settings', { general: { bg: { color: '#0e1013', alpha: 35 } } });
        fire('overlay:state', state(false));
        await nextTick();
        expect(tileKeys('ccBoss')).toEqual(['1164', '1165', '1166', '323']);
        expect((comp('ccBoss').element as HTMLElement).style.background).toBe('rgba(14, 16, 19, 0.35)');
    });

    it('the stage carries the highlight colours', async () => {
        await mountApp();
        fire('overlay:settings', { general: { warn: '#112233' } });
        await nextTick();
        const st = (w!.find('.ov-stage').element as HTMLElement).style;
        expect(st.getPropertyValue('--hl-warn')).toBe('#112233');
        expect(st.getPropertyValue('--hl-ok')).toBe('#5cc26a');
    });

    describe('sections and units', () => {
        it('a stored unit layout draws its own titled frame and leaves the group', async () => {
            condNameMap.value = { 1164: '減少防禦/保護' };
            await mountApp();
            fire('overlay:state', state(false, { 'ccBoss-1164': UNIT }));
            await nextTick();
            const u = comp('ccBoss-1164');
            expect(u.exists()).toBe(true);
            expect(u.find('[data-tag]').text()).toContain('BOSS CC・減少防禦/保護');
            expect(tileKeys('ccBoss-1164')).toEqual(['1164']);
            expect(tileKeys('ccBoss')).toEqual(['1165', '1166', '323']);
        });

        it('a unit layout for an item that does not exist draws nothing', async () => {
            await mountApp();
            fire('overlay:state', state(false, { 'ccBoss-999': UNIT }));
            await nextTick();
            expect(comp('ccBoss-999').exists()).toBe(false);
            expect(tileKeys('ccBoss')).toEqual(['1164', '1165', '1166', '323']);
        });

        it('a stored order puts those keys first, the rest after in settings order', async () => {
            await mountApp();
            fire('overlay:state', state(false, { ccBoss: { enabled: true, anchor: 'tl', x: 24, y: 24, width: 300, maxRows: 1, order: ['1166', '1164'] } }));
            await nextTick();
            expect(tileKeys('ccBoss')).toEqual(['1166', '1164', '1165', '323']);
        });

        it('收回 removes the unit layout', async () => {
            await mountApp();
            fire('overlay:state', state(false, { 'ccBoss-1164': UNIT }));
            await nextTick();
            await comp('ccBoss-1164').get('[data-back]').trigger('click');
            expect(removes()).toEqual(['ccBoss-1164']);
            // Shown merged at once, before Go echoes the removal.
            expect(comp('ccBoss-1164').exists()).toBe(false);
            expect(tileKeys('ccBoss')).toContain('1164');
        });

        it('收回 frees a frame docked under the unit where it stands', async () => {
            await mountApp();
            const under = { enabled: true, anchor: 'tl', x: 0, y: 0, width: 200, maxRows: 1, dock: 'ccBoss-1164' };
            fire('overlay:state', state(false, { 'ccBoss-1164': UNIT, cooldown: under }));
            await nextTick();
            const before = pos('cooldown');
            await comp('ccBoss-1164').get('[data-back]').trigger('click');
            expect(removes()).toEqual(['ccBoss-1164']);
            expect(sets()).toHaveLength(1);
            expect(sets()[0]).toMatchObject({ id: 'cooldown', layout: { dock: '' } });
            await nextTick();
            expect(pos('cooldown')).toEqual(before);
        });

        it('dragging a tile out of its group detaches it where it was dropped', async () => {
            await mountApp();
            fire('overlay:state', state(false));
            await nextTick();
            await comp('ccBoss').get('[data-tile-key="1164"]').trigger('pointerdown', ptr(40, 40));
            await w!.find('.ov-root').trigger('pointermove', ptr(700, 450));
            expect(w!.find('[data-ghost]').exists()).toBe(true);
            expect(tileKeys('ccBoss')).toEqual(['1165', '1166', '323']);
            await w!.find('.ov-root').trigger('pointerup', ptr(700, 450));
            expect(sets()).toHaveLength(1);
            expect(sets()[0]).toMatchObject({ id: 'ccBoss-1164', layout: { width: 120, dock: '' } });
            await nextTick();
            expect(comp('ccBoss-1164').exists()).toBe(true);
            expect(w!.find('[data-ghost]').exists()).toBe(false);
        });

        it('dropping a tile inside its group saves the new order', async () => {
            await mountApp();
            fire('overlay:state', state(false));
            await nextTick();
            await comp('ccBoss').get('[data-tile-key="1164"]').trigger('pointerdown', ptr(40, 40));
            // happy-dom has no layout: every tile box is empty, so the drop lands at the end.
            await w!.find('.ov-root').trigger('pointerup', ptr(200, 80));
            expect(sets()).toEqual([{ id: 'ccBoss', layout: expect.objectContaining({ order: ['1165', '1166', '323', '1164'], x: 24 }) }]);
        });

        it('a unit frame dropped on its own group merges back', async () => {
            await mountApp();
            fire('overlay:state', state(false, { 'ccBoss-1164': UNIT }));
            await nextTick();
            const u = comp('ccBoss-1164');
            await u.trigger('pointerdown', ptr(610, 410));
            await u.trigger('pointermove', ptr(200, 60));
            await u.trigger('pointerup', ptr(200, 60));
            expect(removes()).toEqual(['ccBoss-1164']);
            expect(sets().map(s => [s.id, s.layout.order])).toEqual([['ccBoss', ['1165', '1166', '323', '1164']]]);
        });

        it('a stored group draws one frame with its members in order; the section leaves them out', async () => {
            await mountApp();
            fire('overlay:state', state(false, { 'ccBoss-g1': { ...UNIT, order: ['1166', '1164'] } }));
            await nextTick();
            expect(tileKeys('ccBoss-g1')).toEqual(['1166', '1164']);
            expect(tileKeys('ccBoss')).toEqual(['1165', '323']);
            expect(comp('ccBoss-g1').find('[data-tag]').text()).toContain('BOSS CC・增傷、減物保');
        });

        it('a tile dropped on a unit frame starts a group there', async () => {
            await mountApp();
            fire('overlay:state', state(false, { 'ccBoss-1164': UNIT }));
            await nextTick();
            await comp('ccBoss').get('[data-tile-key="1165"]').trigger('pointerdown', ptr(40, 40));
            await w!.find('.ov-root').trigger('pointermove', ptr(650, 450));
            await w!.find('.ov-root').trigger('pointerup', ptr(650, 450));
            expect(sets()).toEqual([{ id: 'ccBoss-g1', layout: { ...UNIT, order: ['1164', '1165'] } }]);
            expect(removes()).toEqual(['ccBoss-1164']);
            await nextTick();
            expect(tileKeys('ccBoss-g1')).toEqual(['1164', '1165']);
        });

        it('a tile dragged out of a group of two leaves the other as a unit', async () => {
            await mountApp();
            fire('overlay:state', state(false, { 'ccBoss-g1': { ...UNIT, order: ['1164', '1165'] } }));
            await nextTick();
            await comp('ccBoss-g1').get('[data-tile-key="1165"]').trigger('pointerdown', ptr(610, 410));
            await w!.find('.ov-root').trigger('pointermove', ptr(1000, 650));
            await w!.find('.ov-root').trigger('pointerup', ptr(1000, 650));
            expect(sets().map(s => s.id)).toEqual(['ccBoss-1164', 'ccBoss-1165']);
            expect(removes()).toEqual(['ccBoss-g1']);
        });

        it('收回 on a group puts every member back', async () => {
            await mountApp();
            fire('overlay:state', state(false, { 'ccBoss-g1': { ...UNIT, order: ['1164', '1165'] } }));
            await nextTick();
            await comp('ccBoss-g1').get('[data-back]').trigger('click');
            expect(removes()).toEqual(['ccBoss-g1']);
            expect(tileKeys('ccBoss')).toEqual(['1164', '1165', '1166', '323']);
        });

        it('the section title shows only when the look turns it on, on groups too', async () => {
            await mountApp();
            fire('overlay:state', state(false, { 'ccBoss-g1': { ...UNIT, order: ['1164', '1165'] }, 'ccBoss-1166': UNIT }));
            fire('overlay:settings', { ccSelf: { look: { title: false } } });
            await nextTick();
            expect(w!.find('[data-title]').exists()).toBe(false);
            fire('overlay:settings', { ccBoss: { look: { title: true } }, ccSelf: { look: { title: false } } });
            await nextTick();
            expect(comp('ccBoss').get('[data-title]').text()).toBe('BOSS CC');
            expect(comp('ccBoss-g1').get('[data-title]').text()).toBe('BOSS CC');
            expect(comp('ccBoss-1166').find('[data-title]').exists()).toBe(false);
            expect(comp('ccSelf').find('[data-title]').exists()).toBe(false);
        });

        it('a unit frame dropped elsewhere just moves', async () => {
            await mountApp();
            fire('overlay:state', state(false, { 'ccBoss-1164': UNIT }));
            await nextTick();
            const u = comp('ccBoss-1164');
            await u.trigger('pointerdown', ptr(610, 410));
            await u.trigger('pointermove', ptr(810, 510, { altKey: true }));
            await u.trigger('pointerup', ptr(810, 510, { altKey: true }));
            expect(removes()).toEqual([]);
            expect(sets()[0].id).toBe('ccBoss-1164');
        });
    });

    describe('by-member party grid', () => {
        const party = async () => {
            await mountApp();
            fire('overlay:state', state(true));
            session.inDungeon.value = true;
            appear('p1', 8001, 100, 'Alice');
            appear('p2', 8001, 100, 'Bob');
            appear('b1', BOSS_RACE, 100);
            fire('overlay:settings', { ccParty: { items: [{ id: 680 }], look: { arrange: 'byMember' } } });
            hit('p1', 'b1', 1000, 100);
            hit('p2', 'b1', 1001, 100);
            cc('p1', 680, 1000, Date.now() / 1000 + 100);
            cc('p2', 680, 1000, Date.now() / 1000 + 100);
            await tick(250);
        };

        it('draws one row per member while locked', async () => {
            await party();
            expect(comp('ccParty').findAll('[data-member-row]')).toHaveLength(2);
            expect(comp('ccParty').findAll('.ov-lbl')).toHaveLength(0);
        });

        it('one grid: name column plus a cell per class in every row', async () => {
            await party();
            fire('overlay:settings', { ccParty: { items: [{ id: 680 }, { id: 63 }], look: { arrange: 'byMember', gap: 'keep' } } });
            await tick(250);
            const grid = comp('ccParty').get('.ov-members');
            expect(grid.attributes('style')).toContain('max-content repeat(2, max-content)');
            for (const r of comp('ccParty').findAll('[data-member-row]')) expect(r.findAll('[data-cell]')).toHaveLength(2);
        });

        describe('while editing', () => {
            const edit = async (items = [{ id: 680 }, { id: 192 }]) => {
                await mountApp();
                fire('overlay:state', state(false));
                fire('overlay:settings', { ccParty: { items, look: { arrange: 'byMember' } } });
                await nextTick();
            };
            const inFrame = () => { const [l, t] = pos('ccParty'); return [l + 20, t + 10]; };
            const grab = async () => {
                const [x, y] = inFrame();
                await comp('ccParty').get('[data-tile-key="680"]').trigger('pointerdown', ptr(x, y));
                await w!.find('.ov-root').trigger('pointermove', ptr(x + 8, y + 8));
            };

            it('draws the grid with three sample teammates when nobody is live', async () => {
                await edit();
                const rows = comp('ccParty').findAll('[data-member-row]');
                expect(rows.map(r => r.get('.ov-member-name').text())).toEqual(['範例1', '範例2', '範例3']);
            });

            it('lifting a tile takes its whole merged column out and shows the bar', async () => {
                await edit();
                expect(comp('ccParty').findAll('[data-tile-key="192"]')).toHaveLength(0);
                await grab();
                expect(comp('ccParty').findAll('[data-tile-key]')).toHaveLength(0);
                expect(w!.find('[data-ghost]').exists()).toBe(true);
                expect(comp('ccParty').find('[data-col-bar]').exists()).toBe(true);
            });

            it('the ghost is the column as a vertical strip, one tile per row', async () => {
                await edit();
                await grab();
                expect(w!.find('[data-ghost] .ov-ghost-col').findAll('.ov-tile')).toHaveLength(3);
            });

            it('releasing over empty space makes a new frame holding the whole column', async () => {
                await edit();
                await grab();
                await w!.find('.ov-root').trigger('pointermove', ptr(900, 600));
                await w!.find('.ov-root').trigger('pointerup', ptr(900, 600));
                const g = sets().find(s => s.id === 'ccParty-g1');
                expect(g?.layout.order).toEqual(['680', '192']);
            });

            it('lifting the only column of a group moves that group and keeps its width', async () => {
                await mountApp();
                fire('overlay:state', state(false, { 'ccParty-g1': { ...UNIT, width: 260, order: ['680', '192'] } }));
                fire('overlay:settings', { ccParty: { items: [{ id: 680 }, { id: 192 }], look: { arrange: 'byMember' } } });
                await nextTick();
                await comp('ccParty-g1').get('[data-tile-key="680"]').trigger('pointerdown', ptr(610, 410));
                await w!.find('.ov-root').trigger('pointermove', ptr(1000, 650));
                await w!.find('.ov-root').trigger('pointerup', ptr(1000, 650));
                expect(sets().map(s => s.id)).toEqual(['ccParty-g1']);
                expect(sets()[0].layout).toMatchObject({ width: 260, order: ['680', '192'] });
            });

            it('dragging a unit frame over the grid shows the column bar there', async () => {
                await mountApp();
                fire('overlay:state', state(false, { 'ccParty-63': UNIT }));
                fire('overlay:settings', { ccParty: { items: [{ id: 680 }, { id: 63 }], look: { arrange: 'byMember' } } });
                await nextTick();
                const [x, y] = [pos('ccParty')[0] + 20, pos('ccParty')[1] + 10];
                const u = comp('ccParty-63');
                await u.trigger('pointerdown', ptr(610, 410));
                await u.trigger('pointermove', ptr(x, y));
                expect(comp('ccParty').find('[data-col-bar]').exists()).toBe(true);
            });

            it('dropping a grid column into another frame moves every key of the column', async () => {
                await mountApp();
                fire('overlay:state', state(false, { 'ccParty-63': UNIT }));
                fire('overlay:settings', { ccParty: { items: [{ id: 680 }, { id: 192 }, { id: 63 }], look: { arrange: 'byMember' } } });
                await nextTick();
                await grab();
                await w!.find('.ov-root').trigger('pointermove', ptr(660, 430));
                await w!.find('.ov-root').trigger('pointerup', ptr(660, 430));
                const g = sets().find(s => s.layout.order);
                expect(g?.layout.order).toEqual(expect.arrayContaining(['680', '192', '63']));
                expect((g?.layout.order as string[]).length).toBe(3);
            });

            it('a flow frame still draws the flow tiles', async () => {
                await edit();
                expect(comp('ccBoss').find('.ov-members').exists()).toBe(false);
                expect(comp('ccBoss').findAll('.ov-tiles [data-tile-key]').length).toBeGreaterThan(0);
            });
        });
    });

    describe('when sections show while locked', () => {
        const me = () => {
            appear('me', 8001, 100, 'Me');
            actorManager.value.onEvent({ EventId: 14, At: 100, Id: 'me', Name: 'Me' } as unknown as eventBase);
            cc('me', 680, Date.now() / 1000 - 5, Date.now() / 1000 + 100);
        };

        it('自己 CC only inside a dungeon, units included', async () => {
            await mountApp();
            fire('overlay:settings', { ccSelf: { items: [{ id: 680 }, { id: 192 }] } });
            fire('overlay:state', state(true, { 'ccSelf-192': UNIT }));
            me();
            cc('me', 192, Date.now() / 1000 - 5, Date.now() / 1000 + 100);
            await tick(250);
            expect(comp('ccSelf').exists()).toBe(false);
            expect(comp('ccSelf-192').exists()).toBe(false);
            session.inDungeon.value = true;
            await tick(250);
            expect(comp('ccSelf').exists()).toBe(true);
            expect(comp('ccSelf-192').exists()).toBe(true);
        });

        it('without a boss neither the battle info nor BOSS CC is drawn', async () => {
            await mountApp();
            fire('overlay:state', state(true));
            appear('p1', 8001, 100, 'Alice');
            hit('p1', 'm1', 1000, 100);
            fire('overlay:target', { targetId: '' });
            session.inDungeon.value = true;
            await tick();
            expect(comp('dps').exists()).toBe(false);
            expect(comp('ccBoss').exists()).toBe(false);
        });

        it('a dead boss hides BOSS CC but the battle info stays while it has rows', async () => {
            await mountApp();
            fire('overlay:state', state(true));
            boss();
            await tick();
            expect(comp('ccBoss').exists()).toBe(true);
            actorManager.value.onEvent({ EventId: 21, At: 1001, Id: 'b1' } as unknown as eventBase);
            await tick();
            expect(comp('dps').exists()).toBe(true);
            expect(comp('ccBoss').exists()).toBe(false);
        });

        it('a boss with no damage rows draws no battle info', async () => {
            await mountApp();
            fire('overlay:state', state(true));
            appear('b1', BOSS_RACE, 100);
            fire('overlay:target', { targetId: '' });
            await tick();
            expect(comp('dps').exists()).toBe(false);
        });
    });

    it('dragging the BOSS CC panel to the middle saves once, with the centre anchor', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        expect(pos('ccBoss')).toEqual([24, 24]);
        const c = comp('ccBoss');
        await c.trigger('pointerdown', ptr(50, 50));
        await c.trigger('pointermove', ptr(300, 200));
        await c.trigger('pointermove', ptr(512, 332));
        expect(sets()).toHaveLength(0);
        expect(w!.find('[data-guide]').exists()).toBe(true);
        expect(w!.find('[data-grid]').exists()).toBe(true);
        await c.trigger('pointerup', ptr(512, 332));
        expect(sets()).toHaveLength(1);
        expect(sets()[0].id).toBe('ccBoss');
        expect(sets()[0].layout).toMatchObject({ anchor: 'center', x: 0, y: 0, width: 300 });
    });

    it('a released drag stays put until Go echoes the saved layout', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        const c = comp('ccBoss');
        await c.trigger('pointerdown', ptr(50, 50));
        await c.trigger('pointermove', ptr(512, 332));
        await c.trigger('pointerup', ptr(512, 332));
        const saved = sets()[0].layout;
        const [l, t] = pos('ccBoss');
        expect([l, t]).not.toEqual([24, 24]);
        fire('overlay:state', state(false, { ccBoss: saved }));
        await nextTick();
        expect(pos('ccBoss')).toEqual([l, t]);
    });

    it('a pending layout is dropped after a while if no echo arrives', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        const c = comp('ccBoss');
        await c.trigger('pointerdown', ptr(50, 50));
        await c.trigger('pointermove', ptr(512, 332));
        await c.trigger('pointerup', ptr(512, 332));
        expect(pos('ccBoss')).not.toEqual([24, 24]);
        await tick(2500);
        expect(pos('ccBoss')).toEqual([24, 24]);
    });

    it('holding Alt turns snapping off', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        const c = comp('ccBoss');
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
        const c = comp('ccBoss');
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
        expect(pos('ccBoss')).toEqual([24, 24]);
    });

    it('a cancelled pointer ends the drag without saving', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        const c = comp('ccBoss');
        await c.trigger('pointerdown', ptr(50, 50));
        await c.trigger('pointermove', ptr(516, 336));
        await c.trigger('pointercancel', ptr(516, 336));
        expect(sets()).toHaveLength(0);
        expect(w!.find('[data-guide]').exists()).toBe(false);
        expect(pos('ccBoss')).toEqual([24, 24]);
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
        expect(pos('ccBoss')).toEqual([0, 0]);
        expect(sets()).toHaveLength(0);
    });

    it('the anchor badge cycles the anchor without moving the component', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        const before = pos('ccBoss');
        await comp('ccBoss').find('[data-anchor-badge]').trigger('click');
        expect(sets()).toHaveLength(1);
        expect(sets()[0].layout).toMatchObject({ anchor: 'tr', x: 24 + 300 - 1280, y: 24 });
        expect(pos('ccBoss')).toEqual(before);
    });

    it('cycling the anchor of a clamped component keeps the stored position', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        await resize(200, 80);
        expect(pos('ccBoss')).toEqual([0, 0]);
        await comp('ccBoss').find('[data-anchor-badge]').trigger('click');
        // The stored (24, 24) converted to the right anchor, not the clamped (0, 0).
        expect(sets()[0].layout).toMatchObject({ anchor: 'tr', x: 24 + 300 - 200, y: 24 });
    });

    it('dragging the width handle of a left-anchored component widens it on the right', async () => {
        await mountApp();
        fire('overlay:state', state(false));
        await nextTick();
        const c = comp('ccBoss');
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
        const c = comp('ccBoss');
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
        fire('overlay:state', state(false, { ccBoss: { enabled: false, anchor: 'tl', x: 24, y: 24, width: 300, maxRows: 6 } }));
        await nextTick();
        await comp('ccBoss').find('[data-toggle]').trigger('click');
        expect(sets()[0]).toMatchObject({ id: 'ccBoss', layout: { enabled: true, anchor: 'tl' } });
    });

    it('toolbar: lock sends set-locked; reset sends the defaults, keeps enabled and merges units back', async () => {
        await mountApp();
        fire('overlay:state', state(false, {
            ccBoss: { enabled: false, anchor: 'br', x: -5, y: -5, width: 500, maxRows: 2, order: ['323'] }, 'cooldown-59005': UNIT,
        }));
        await nextTick();
        await w!.find('[data-lock]').trigger('click');
        expect(bridge.emit).toHaveBeenCalledWith('overlay:set-locked', { locked: true });
        await w!.find('[data-reset]').trigger('click');
        const s = sets();
        expect(s.map(x => x.id)).toEqual(['dps', 'ccBoss', 'ccSelf', 'ccParty', 'cooldown', 'burst', 'misc', 'alerts']);
        expect(removes()).toEqual(['cooldown-59005']);
        expect(s[1].layout).toEqual({ enabled: false, anchor: 'tl', x: 249, y: 107, width: 300, maxRows: 1 });
        expect(s[2].layout.dock ?? '').toBe('');
        expect(s[0].layout).toMatchObject({ enabled: true, anchor: 'tr' });
    });

    it('dps rows honour the column settings', async () => {
        await mountApp();
        fire('overlay:state', state(true));
        boss();
        hit('p1', 'b1', 1010, 100);
        fire('overlay:target', { targetId: '' });
        await tick();
        expect(w!.find('[data-row]').text()).toContain('Alice');
        expect(w!.findAll('[data-col]').map(c => c.attributes('data-col'))).toEqual(['dps', 'share']);
        fire('overlay:settings', { dps: { columns: { dps: false, total: false, share: false } } });
        await nextTick();
        expect(w!.findAll('[data-col]')).toHaveLength(0);
    });

    it('a boss CC near its end gets the warn look, a missing one the gone look', async () => {
        await mountApp();
        fire('overlay:state', state(true));
        boss();
        const now = Date.now() / 1000;
        cc('b1', 1164, now - 5, now + 2);
        cc('b1', 1165, now - 5, now + 60);
        fire('overlay:target', { targetId: 'b1' });
        await tick(250);
        const cls = (k: string) => comp('ccBoss').get(`[data-tile-key="${k}"]`).classes();
        expect(cls('1164')).toContain('warn');
        expect(cls('1165')).toContain('ok');
        expect(cls('1166')).toContain('gone');
    });

    describe('docking', () => {
        it('the CC panels hang under each other and follow a dragged host', async () => {
            await mountApp();
            fire('overlay:state', state(false));
            await nextTick();
            expect([pos('ccSelf'), pos('ccParty')]).toEqual([[24, 124], [24, 224]]);
            const c = comp('ccBoss');
            await c.trigger('pointerdown', ptr(50, 50));
            await c.trigger('pointermove', ptr(150, 90, { altKey: true }));
            expect([pos('ccSelf'), pos('ccParty')]).toEqual([[124, 164], [124, 264]]);
            await c.trigger('pointerup', ptr(150, 90, { altKey: true }));
            expect(sets().map(x => x.id)).toEqual(['ccBoss']);
        });

        it('a hidden host gives its place to what is docked under it', async () => {
            await mountApp();
            const dps = { enabled: true, anchor: 'tl', x: 10, y: 0, width: 260, maxRows: 8, dock: 'ccBoss' };
            const ccBoss = { enabled: false, anchor: 'tl', x: 24, y: 24, width: 300, maxRows: 1 };
            fire('overlay:state', state(true, { dps, ccBoss }));
            boss();
            fire('overlay:target', { targetId: '' });
            await tick();
            expect(comp('ccBoss').exists()).toBe(false);
            expect(pos('dps')).toEqual([34, 24]);
        });

        it('dropping a panel just under another docks it; the chain badge detaches it in place', async () => {
            await mountApp();
            fire('overlay:state', state(false));
            await nextTick();
            const c = comp('cooldown');
            const [l, t] = pos('cooldown');
            await c.trigger('pointerdown', ptr(l + 10, t + 10));
            // ccParty spans y 224-324: a top edge at 334 is within reach of its bottom.
            await c.trigger('pointermove', ptr(24 + 10 + 2, 334 + 10));
            expect(comp('ccParty').classes()).toContain('dock-target');
            await c.trigger('pointerup', ptr(24 + 10 + 2, 334 + 10));
            const saved = sets()[0].layout;
            expect(saved).toMatchObject({ dock: 'ccParty', x: 0, y: 0 });
            fire('overlay:state', state(false, { cooldown: saved }));
            await nextTick();
            expect(pos('cooldown')).toEqual([24, 324]);
            await comp('cooldown').get('[data-undock]').trigger('click');
            expect(sets()[1].layout).toMatchObject({ dock: '', anchor: 'bl', x: 24, y: -296 });
        });

        it('a panel cannot dock under one that already has a follower', async () => {
            await mountApp();
            fire('overlay:state', state(false));
            await nextTick();
            const c = comp('cooldown');
            const [l, t] = pos('cooldown');
            await c.trigger('pointerdown', ptr(l + 10, t + 10));
            await c.trigger('pointermove', ptr(24 + 10, 124 + 10));
            expect(w!.find('.dock-target').exists()).toBe(false);
            await c.trigger('pointerup', ptr(24 + 10, 124 + 10));
            expect(sets()[0].layout).toMatchObject({ dock: '' });
        });
    });
});

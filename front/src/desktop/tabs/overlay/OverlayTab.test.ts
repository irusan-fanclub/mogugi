// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';
import type { OverlayState } from '@/lib/overlayProtocol';
import { defaultOverlaySettings, DEFAULT_BOSS_CC, DEFAULT_SELF_CC, type OverlaySettings } from '@/lib/overlaySettings';
import { condNameMap } from '@/store';

// Lazy lookups: vi.mock factories run before the module-level refs exist.
const stateRef = () => state;
const settingsRef = () => settings;

const h = vi.hoisted(() => ({
    setLayout: vi.fn(), setLocked: vi.fn(), setHotkey: vi.fn(), restartElevated: vi.fn(),
    setHidden: vi.fn(), setVisibleHotkey: vi.fn(),
}));
const { setLayout, setLocked, setHotkey } = h;
const state = ref<OverlayState | null>(null);
const settings = ref<OverlaySettings>(defaultOverlaySettings());
vi.mock('../../overlay/useOverlayState', () => ({
    useOverlayState: () => ({ state: stateRef(), ...h, refresh: vi.fn(), hotkeyAttempts: { value: 0 } }),
}));
vi.mock('../../overlay/overlayLink', () => ({
    get overlaySettings() { return settingsRef(); },
    updateOverlaySettings: (mut: (s: OverlaySettings) => void) => {
        const r = settingsRef();
        const next = JSON.parse(JSON.stringify(r.value)) as OverlaySettings;
        mut(next);
        r.value = next;
    },
}));

import OverlayTab from './OverlayTab.vue';
import LockBar from './LockBar.vue';

let w: VueWrapper | null = null;
let roCb: ResizeObserverCallback | null = null;

beforeEach(() => {
    state.value = { locked: true, hotkey: 'Ctrl+Alt+L', hotkeyError: '', licensed: true, elevated: true, elevateError: '', hidden: false, visibleHotkey: 'Ctrl+Alt+O', visibleHotkeyError: '', layout: { dps: { enabled: false, anchor: 'tr', x: -24, y: 24, width: 260, maxRows: 8 } }, gameFound: true };
    settings.value = defaultOverlaySettings();
    condNameMap.value = { 516: '覺醒', 680: '序曲', 192: '活潑板', 999: '測試狀態' };
    setLayout.mockClear(); setLocked.mockClear(); setHotkey.mockClear();
    roCb = null;
    vi.stubGlobal('ResizeObserver', class {
        constructor(cb: ResizeObserverCallback) { roCb = cb; }
        observe() {}
        disconnect() {}
        unobserve() {}
    });
});
afterEach(() => { w?.unmount(); w = null; vi.unstubAllGlobals(); });

const mountTab = () => (w = mount(OverlayTab, { attachTo: document.body }));
const setWidth = async (width: number) => {
    roCb!([{ contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver);
    await nextTick();
};
const items = () => w!.findAll('[data-overlay-item]');

describe('LockBar', () => {
    it('locked: shows state, hotkey and the unlock button', async () => {
        w = mount(LockBar, { props: { locked: true, hotkey: 'Ctrl+Alt+L', hotkeyError: '' } });
        expect(w.text()).toContain('已鎖定（滑鼠穿透）');
        expect(w.text()).toContain('Ctrl+Alt+L');
        const btn = w.findAll('button').find(b => b.text() === '解鎖以編輯版面')!;
        await btn.trigger('click');
        expect(w.emitted('setLocked')).toEqual([[false]]);
    });

    it('unlocked: shows 已解鎖 and a lock button', async () => {
        w = mount(LockBar, { props: { locked: false, hotkey: 'Ctrl+Alt+L', hotkeyError: '' } });
        expect(w.text()).toContain('已解鎖（編輯版面）');
        await w.findAll('button').find(b => b.text() === '鎖定')!.trigger('click');
        expect(w.emitted('setLocked')).toEqual([[true]]);
    });

    it('shows the visibility row and emits setHidden both ways', async () => {
        w = mount(LockBar, { props: { locked: true, hotkey: 'Ctrl+Alt+L', hotkeyError: '', visibleHotkey: 'Ctrl+Alt+O' } });
        const row = w.get('[data-visibility]');
        expect(row.text()).toContain('顯示中');
        expect(row.text()).toContain('Ctrl+Alt+O');
        await row.findAll('button').find(b => b.text() === '隱藏')!.trigger('click');
        await w.setProps({ hidden: true });
        expect(w.get('[data-visibility]').text()).toContain('已隱藏全部 overlay');
        await w.get('[data-visibility]').findAll('button').find(b => b.text() === '顯示')!.trigger('click');
        expect(w.emitted('setHidden')).toEqual([[true], [false]]);
    });

    it('shows the visibility hotkey error line', () => {
        w = mount(LockBar, { props: { locked: true, hotkey: 'Ctrl+Alt+L', hotkeyError: '', visibleHotkeyError: '快捷鍵 Ctrl+Alt+L 已用於「鎖定」' } });
        expect(w.find('[data-visible-hotkey-error]').text()).toBe('快捷鍵 Ctrl+Alt+L 已用於「鎖定」');
        expect(w.find('[data-hotkey-error]').exists()).toBe(false);
    });

    it('shows the hotkey error line', () => {
        w = mount(LockBar, { props: { locked: true, hotkey: 'Ctrl+Alt+L', hotkeyError: '快捷鍵已被占用' } });
        expect(w.find('[data-hotkey-error]').text()).toBe('快捷鍵已被占用');
    });
});

describe('OverlayTab list', () => {
    it('shows a notice under the lock bar only when unlicensed', async () => {
        mountTab();
        expect(w!.find('[data-unlicensed]').exists()).toBe(false);
        state.value = { ...state.value!, licensed: false };
        await nextTick();
        expect(w!.find('[data-unlicensed]').text()).toBe('未授權，overlay 不會開啟');
    });

    it('lists the four components with switches bound to state.layout', async () => {
        mountTab();
        expect(items().map(i => i.find('.name').text())).toEqual(['DPS', 'CC 監測', '技能冷卻', '提醒']);
        const sw = items().map(i => i.find('[role="switch"]'));
        expect(sw.map(s => s.attributes('aria-checked'))).toEqual(['false', 'true', 'true', 'true']);
        await sw[0].trigger('click');
        expect(setLayout).toHaveBeenCalledWith('dps', { enabled: true, anchor: 'tr', x: -24, y: 24, width: 260, maxRows: 8 });
        await sw[1].trigger('click');
        expect(setLayout).toHaveBeenCalledWith('cc', { enabled: false, anchor: 'tl', x: 24, y: 24, width: 300, maxRows: 8 });
    });

    it('passes hidden state to the lock bar and calls setHidden', async () => {
        mountTab();
        state.value = { ...state.value!, hidden: true };
        await nextTick();
        expect(w!.get('[data-visibility]').text()).toContain('已隱藏全部 overlay');
        await w!.get('[data-visibility]').findAll('button').find(b => b.text() === '顯示')!.trigger('click');
        expect(h.setHidden).toHaveBeenCalledWith(false);
    });

    it('lock bar button calls setLocked(false)', async () => {
        mountTab();
        await w!.findAll('button').find(b => b.text() === '解鎖以編輯版面')!.trigger('click');
        expect(setLocked).toHaveBeenCalledWith(false);
    });
});

describe('DPS settings', () => {
    it('opacity, font size, columns and top info write to overlaySettings.dps', async () => {
        mountTab();
        await items()[0].trigger('click');
        const range = w!.find('[data-dps-opacity]');
        expect((range.element as HTMLInputElement).value).toBe('60');
        await range.setValue('35');
        expect(settings.value.dps.opacity).toBe(35);

        await w!.findAll('[role="radio"]').find(r => r.text() === '大')!.trigger('click');
        expect(settings.value.dps.fontSize).toBe('l');

        await w!.findAll('[role="checkbox"]').find(c => c.text() === '總傷害')!.trigger('click');
        expect(settings.value.dps.columns.total).toBe(true);
        await w!.findAll('[role="checkbox"]').find(c => c.text() === '隊伍 DPS')!.trigger('click');
        expect(settings.value.dps.top.partyDps).toBe(true);
        expect(w!.findAll('[role="checkbox"]').map(c => c.text())).toEqual(['DPS', '總傷害', '佔比', 'BOSS', '時間', '隊伍 DPS']);
    });
});

describe('CC settings', () => {
    async function openCc() {
        mountTab();
        await items()[1].trigger('click');
    }
    const sections = () => w!.findAll('[data-cc-section]');

    it('has opacity, icon size and three sections', async () => {
        await openCc();
        expect(sections().map(s => s.find('.title').text())).toEqual(['BOSS', '自身', '隊友']);
        await w!.find('[data-cc-opacity]').setValue('40');
        expect(settings.value.cc.opacity).toBe(40);
        await w!.findAll('[role="radio"]').find(r => r.text() === '小')!.trigger('click');
        expect(settings.value.cc.iconSize).toBe('s');
    });

    it('removes with the x button', async () => {
        await openCc();
        await sections()[1].findAll('[data-remove] button')[0].trigger('click');
        expect(settings.value.cc.sections.self).toEqual(DEFAULT_SELF_CC.slice(1));
        expect(settings.value.cc.sections.boss).toEqual(DEFAULT_BOSS_CC);
    });

    it('adds from the search result list', async () => {
        await openCc();
        const self = sections()[1];
        await self.findAll('button').find(b => b.text() === '新增')!.trigger('click');
        await self.find('input').setValue('測試');
        const rows = self.findAll('[data-add]');
        expect(rows).toHaveLength(1);
        await rows[0].trigger('click');
        expect(settings.value.cc.sections.self).toEqual([...DEFAULT_SELF_CC, 999]);
    });

    it('reorders without a pinned item', async () => {
        await openCc();
        const rows = sections()[1].findAll('.row');
        expect(rows[0].attributes('draggable')).toBe('true');
        const dt = { setData() {}, effectAllowed: '' };
        await rows[0].trigger('dragstart', { dataTransfer: dt });
        await rows[1].trigger('dragover', { dataTransfer: dt });
        expect(settings.value.cc.sections.self.slice(0, 2)).toEqual([DEFAULT_SELF_CC[1], DEFAULT_SELF_CC[0]]);
    });

    it('恢復預設 restores that section only', async () => {
        await openCc();
        const self = sections()[1];
        await self.findAll('[data-remove] button')[0].trigger('click');
        await self.findAll('button').find(b => b.text() === '恢復預設')!.trigger('click');
        expect(settings.value.cc.sections.self).toEqual(DEFAULT_SELF_CC);
    });
});

describe('narrow mode', () => {
    it('shows the list only, opens settings on click and goes back', async () => {
        mountTab();
        await setWidth(600);
        expect(w!.find('[data-overlay-settings]').exists()).toBe(false);
        await items()[0].trigger('click');
        expect(w!.find('[data-overlay-settings]').exists()).toBe(true);
        expect(w!.find('[data-overlay-list]').exists()).toBe(false);
        await w!.findAll('button').find(b => b.text() === '‹ 返回')!.trigger('click');
        expect(w!.find('[data-overlay-list]').exists()).toBe(true);
        expect(w!.find('[data-overlay-settings]').exists()).toBe(false);
    });

    it('wide mode shows both panes', async () => {
        mountTab();
        await setWidth(900);
        expect(w!.find('[data-overlay-list]').exists()).toBe(true);
        expect(w!.find('[data-overlay-settings]').exists()).toBe(true);
    });
    it('offers a relaunch as administrator when not elevated, and shows a failed one', async () => {
        const w = mountTab();
        state.value = { ...state.value!, elevated: false, elevateError: '' };
        await nextTick();
        await w.get('[data-restart-elevated]').trigger('click');
        expect(h.restartElevated).toHaveBeenCalledTimes(1);
        state.value = { ...state.value!, elevateError: '已取消，仍以一般權限執行' };
        await nextTick();
        expect(w.get('[data-elevate-error]').text()).toBe('已取消，仍以一般權限執行');
        state.value = { ...state.value!, elevated: true };
        await nextTick();
        expect(w.find('[data-not-elevated]').exists()).toBe(false);
    });
});

describe('overlay tab page chrome', () => {
    it('scale slider writes overlaySettings.scale', async () => {
        mountTab();
        await w!.get('[data-overlay-scale]').setValue('120');
        expect(settings.value.scale).toBe(120);
        expect(w!.text()).toContain('overlay 只在視窗模式或無邊框視窗模式下看得到');
    });

    it('shows the no-game notice only when gameFound is false', async () => {
        mountTab();
        expect(w!.find('[data-no-game]').exists()).toBe(false);
        state.value = { ...state.value!, gameFound: false };
        await nextTick();
        expect(w!.get('[data-no-game]').text()).toBe('找不到遊戲視窗，遊戲啟動後 overlay 會自動出現');
    });

    it('cooldown switch sends the full default layout', async () => {
        mountTab();
        await items()[2].find('[role="switch"]').trigger('click');
        expect(setLayout).toHaveBeenCalledWith('cooldown', { enabled: false, anchor: 'bl', x: 24, y: -24, width: 240, maxRows: 6 });
    });

    it('the row stepper sends the full layout with maxRows changed, within 1-20', async () => {
        mountTab();
        await items()[1].trigger('click');
        expect(w!.get('[data-rows-val]').text()).toBe('8');
        await w!.get('[data-rows-inc]').trigger('click');
        expect(setLayout).toHaveBeenLastCalledWith('cc', { enabled: true, anchor: 'tl', x: 24, y: 24, width: 300, maxRows: 9 });
        await w!.get('[data-rows-dec]').trigger('click');
        expect(setLayout).toHaveBeenLastCalledWith('cc', { enabled: true, anchor: 'tl', x: 24, y: 24, width: 300, maxRows: 7 });
        state.value = { ...state.value!, layout: { ...state.value!.layout, cc: { enabled: true, anchor: 'tl', x: 24, y: 24, width: 300, maxRows: 20 } } };
        await nextTick();
        expect(w!.get('[data-rows-inc]').attributes('disabled')).toBeDefined();
        state.value = { ...state.value!, layout: { ...state.value!.layout, cc: { enabled: true, anchor: 'tl', x: 24, y: 24, width: 300, maxRows: 1 } } };
        await nextTick();
        expect(w!.get('[data-rows-dec]').attributes('disabled')).toBeDefined();
    });

    it('cooldown and alerts pages open; cc page has no 顯示技能冷卻', async () => {
        mountTab();
        await items()[2].trigger('click');
        await w!.get('[data-cooldown-opacity]').setValue('30');
        expect(settings.value.cooldown.opacity).toBe(30);
        await items()[3].trigger('click');
        await w!.get('[data-alerts-opacity]').setValue('20');
        expect(settings.value.alerts.opacity).toBe(20);
        await items()[1].trigger('click');
        expect(w!.text()).not.toContain('顯示技能冷卻');
    });
});

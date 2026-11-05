// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ref, nextTick } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';
import type { OverlayState } from '@/lib/overlayProtocol';
import { defaultOverlaySettings, type OverlaySettings } from '@/lib/overlaySettings';
import { condNameMap } from '@/store';

// Lazy lookups: vi.mock factories run before the module-level refs exist.
const stateRef = () => state;
const settingsRef = () => settings;

const h = vi.hoisted(() => ({
    setLayout: vi.fn(), setLocked: vi.fn(), setHotkey: vi.fn(), restartElevated: vi.fn(),
    setHidden: vi.fn(), setVisibleHotkey: vi.fn(), removeLayout: vi.fn(),
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
    h.removeLayout.mockClear(); setLayout.mockClear(); setLocked.mockClear(); setHotkey.mockClear();
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

describe('OverlayTab nav', () => {
    it('shows a notice under the lock bar only when unlicensed', async () => {
        mountTab();
        expect(w!.find('[data-unlicensed]').exists()).toBe(false);
        state.value = { ...state.value!, licensed: false };
        await nextTick();
        expect(w!.find('[data-unlicensed]').text()).toBe('未授權，overlay 不會開啟');
    });

    it('lists the nine pages in order', () => {
        mountTab();
        expect(items().map(i => i.text())).toEqual(['通用', '簡易戰鬥資訊', 'BOSS CC', '自己 CC', '隊伍 CC', '技能冷卻', '雜項', '爆發提示（開發中）', '提醒（開發中）']);
    });

    it('each page opens its settings', async () => {
        mountTab();
        expect(w!.find('[data-general]').exists()).toBe(true);
        await items()[2].trigger('click');
        expect(w!.get('[data-overlay-settings] h2').text()).toBe('BOSS CC');
        expect(w!.find('[data-item="1164"]').exists()).toBe(true);
        await items()[4].trigger('click');
        expect(w!.find('[data-item="1164"]').exists()).toBe(false);
        expect(w!.find('[data-item="680"]').exists()).toBe(true);
        await items()[5].trigger('click');
        expect(w!.find('[data-item="59005"]').exists()).toBe(true);
        await items()[6].trigger('click');
        expect(w!.find('[data-item="428"]').exists()).toBe(true);
        await items()[8].trigger('click');
        await w!.get('[data-alerts-opacity]').setValue('20');
        expect(settings.value.alerts.opacity).toBe(20);
    });

    it('switching page closes an open picker', async () => {
        mountTab();
        await items()[2].trigger('click');
        await w!.get('[data-add]').trigger('click');
        expect(w!.find('[data-picker]').exists()).toBe(true);
        await items()[3].trigger('click');
        expect(w!.find('[data-picker]').exists()).toBe(false);
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

describe('簡易戰鬥資訊 page', () => {
    const openDps = async () => { mountTab(); await items()[1].trigger('click'); };

    it('font size, columns and top info write dpsLook', async () => {
        await openDps();
        await w!.findAll('[role="radio"]').find(r => r.text() === '大')!.trigger('click');
        expect(settings.value.dpsLook.font).toBe('l');
        await w!.findAll('[role="radio"]').find(r => r.text() === '自訂')!.trigger('click');
        expect(settings.value.dpsLook).toMatchObject({ font: 'c', fpx: 17 });
        await w!.findAll('[role="checkbox"]').find(c => c.text() === '總傷害')!.trigger('click');
        expect(settings.value.dpsLook.columns.total).toBe(true);
        await w!.findAll('[role="checkbox"]').find(c => c.text() === '剩餘血量')!.trigger('click');
        expect(settings.value.dpsLook.top.hpLeft).toBe(true);
        expect(w!.findAll('[role="checkbox"]').map(c => c.text())).toEqual(
            ['DPS', '總傷害', '佔比', 'BOSS 名稱', '血量 %', '剩餘血量', '時間', '隊伍 DPS']);
    });

    it('面板底色 自訂 stores its own colour; ↺ restores the look', async () => {
        settings.value.dpsLook.bg = null;
        await openDps();
        await w!.findAll('[role="radio"]').find(r => r.text() === '自訂' && r.element.closest('[data-bg-mode]'))!.trigger('click');
        expect(settings.value.dpsLook.bg).toEqual({ color: '#0e1013', alpha: 0 });
        await w!.get('[data-bg-alpha]').setValue('70');
        expect(settings.value.dpsLook.bg).toEqual({ color: '#0e1013', alpha: 70 });
        await w!.get('[data-reset-look]').trigger('click');
        expect(settings.value.dpsLook.bg).toEqual({ color: '#0e1013', alpha: 25 });
    });

    it('the row stepper writes maxRows of the dps layout, within 1-20', async () => {
        await openDps();
        expect(w!.get('[data-rows-val]').text()).toBe('8');
        await w!.get('[data-rows-inc]').trigger('click');
        expect(setLayout).toHaveBeenLastCalledWith('dps', { enabled: false, anchor: 'tr', x: -24, y: 24, width: 260, maxRows: 9 });
        await w!.get('[data-rows-dec]').trigger('click');
        expect(setLayout).toHaveBeenLastCalledWith('dps', { enabled: false, anchor: 'tr', x: -24, y: 24, width: 260, maxRows: 7 });
        state.value = { ...state.value!, layout: { dps: { enabled: true, anchor: 'tr', x: 0, y: 0, width: 260, maxRows: 20 } } };
        await nextTick();
        expect(w!.get('[data-rows-inc]').attributes('disabled')).toBeDefined();
        state.value = { ...state.value!, layout: { dps: { enabled: true, anchor: 'tr', x: 0, y: 0, width: 260, maxRows: 1 } } };
        await nextTick();
        expect(w!.get('[data-rows-dec]').attributes('disabled')).toBeDefined();
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
});

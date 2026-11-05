// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';
import type { OverlayState } from '@/lib/overlayProtocol';
import { defaultOverlaySettings, type OverlaySettings } from '@/lib/overlaySettings';
import type { CcSectionId } from '@/lib/overlaySections';
import { condNameMap } from '@/store';

const stateRef = () => state;
const settingsRef = () => settings;
const h = vi.hoisted(() => ({ setLayout: vi.fn(), removeLayout: vi.fn() }));
const state = ref<OverlayState | null>(null);
const settings = ref<OverlaySettings>(defaultOverlaySettings());
vi.mock('../../overlay/useOverlayState', () => ({
    useOverlayState: () => ({ state: stateRef(), ...h }),
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

import CcSectionSettings from './CcSectionSettings.vue';

let w: VueWrapper | null = null;
const baseState = (layout: OverlayState['layout'] = {}): OverlayState => ({
    locked: true, hotkey: '', hotkeyError: '', licensed: true, elevated: true, elevateError: '', hidden: false,
    visibleHotkey: '', visibleHotkeyError: '', layout, gameFound: true,
});

beforeEach(() => {
    state.value = baseState();
    settings.value = defaultOverlaySettings();
    condNameMap.value = { 1164: '減少防禦/保護 1164', 680: '戰場的序曲 680', 476: '要害貫通 476', 511: '銳利 511', 1124: '圖安之歌 1124' };
    h.setLayout.mockClear(); h.removeLayout.mockClear();
});
afterEach(() => { w?.unmount(); w = null; vi.useRealTimers(); });

const mountSec = (section: CcSectionId) => (w = mount(CcSectionSettings, { props: { section }, attachTo: document.body }));
const row = (id: number) => w!.get(`[data-item="${id}"]`);
const open = (id: number) => row(id).get('.head').trigger('click');
const ids = (s: CcSectionId) => settings.value[s].items.map(i => i.id);

describe('CcSectionSettings', () => {
    it('ccSelf: 自動延續 only for music CCs; text/voice are disabled', async () => {
        mountSec('ccSelf');
        await open(680);
        expect(row(680).find('[data-renew-field]').exists()).toBe(true);
        const soon = row(680).findAll('[data-soon]');
        expect(soon.length).toBe(4);
        for (const s of soon) {
            expect(s.attributes('title')).toBe('尚未開放');
            expect(s.get('button').attributes('disabled')).toBeDefined();
        }
        await open(476);
        expect(row(476).find('[data-renew-field]').exists()).toBe(false);
    });

    it('隊友秘法 only on the party page, and it saves separately from 自身秘法', async () => {
        mountSec('ccSelf');
        await open(680);
        expect(row(680).find('[data-mate-arcana]').exists()).toBe(false);
        w!.unmount();
        mountSec('ccParty');
        await open(680);
        await row(680).get('[data-mate-arcana] [data-arcana-id="8"]').trigger('click');
        const item = settings.value.ccParty.items[0];
        expect(item.arcana).toEqual([]);
        expect(item.mateArcana).toContain(8);
    });

    it('the 雜項 page starts with the 信念 item', () => {
        mountSec('misc');
        expect(ids('misc')).toEqual([428]);
    });

    it('🗑 arms first, removes on the second click, disarms after 3 s', async () => {
        vi.useFakeTimers();
        mountSec('ccBoss');
        const del = () => row(1164).get('[data-remove]');
        await del().trigger('click');
        expect(ids('ccBoss')).toContain(1164);
        expect(del().classes()).toContain('armed');
        expect(del().attributes('title')).toBe('再點一次移除');
        vi.advanceTimersByTime(3000);
        await w!.vm.$nextTick();
        expect(del().classes()).not.toContain('armed');
        await del().trigger('click');
        await del().trigger('click');
        expect(ids('ccBoss')).not.toContain(1164);
        expect(h.removeLayout).not.toHaveBeenCalled();
    });

    it('removing a pulled-out item drops its layout and its order key', async () => {
        const L = { enabled: true, anchor: 'tl' as const, x: 0, y: 0, width: 120, maxRows: 1 };
        state.value = baseState({ 'ccBoss-1164': L, ccBoss: { ...L, order: ['1165', '1164'] } });
        mountSec('ccBoss');
        expect(row(1164).find('[data-solo]').exists()).toBe(true);
        expect(row(1165).find('[data-solo]').exists()).toBe(false);
        await row(1164).get('[data-remove]').trigger('click');
        await row(1164).get('[data-remove]').trigger('click');
        expect(h.removeLayout).toHaveBeenCalledWith('ccBoss-1164');
        expect(h.setLayout).toHaveBeenCalledWith('ccBoss', { ...L, order: ['1165'] });
    });

    it('↺ restores an edited item and keeps its place', async () => {
        mountSec('ccBoss');
        await open(1164);
        await row(1164).get('[data-label]').setValue('物保');
        await row(1164).get('[data-warn-sec]').setValue('12');
        await row(1164).get('[data-warn-sec]').trigger('change');
        expect(settings.value.ccBoss.items[0]).toMatchObject({ label: '物保', warnSec: 12 });
        await row(1164).get('[data-reset]').trigger('click');
        expect(settings.value.ccBoss.items[0]).toMatchObject({ id: 1164, label: '減物保', warnSec: 30 });
        expect(h.setLayout).not.toHaveBeenCalled();
        expect(h.removeLayout).not.toHaveBeenCalled();
    });

    it('收回 removes the unit layout', async () => {
        const L = { enabled: true, anchor: 'tl' as const, x: 0, y: 0, width: 120, maxRows: 1 };
        state.value = baseState({ 'ccBoss-1166': L });
        mountSec('ccBoss');
        await row(1166).get('[data-solo] button').trigger('click');
        expect(h.removeLayout).toHaveBeenCalledWith('ccBoss-1166');
        expect(ids('ccBoss')).toContain(1166);
    });

    it('收回 of a grouped item: a group of three keeps two, a group of two leaves a unit', async () => {
        const L = { enabled: true, anchor: 'tl' as const, x: 5, y: 0, width: 120, maxRows: 1 };
        state.value = baseState({ 'ccBoss-g1': { ...L, order: ['1164', '1165', '1166'] }, 'ccBoss-g2': { ...L, order: ['323', '9'] } });
        mountSec('ccBoss');
        expect(row(1165).find('[data-solo]').exists()).toBe(true);
        await row(1165).get('[data-solo] button').trigger('click');
        expect(h.setLayout).toHaveBeenCalledWith('ccBoss-g1', { ...L, order: ['1164', '1166'] });
        h.setLayout.mockClear();
        settings.value.ccBoss.items.push({ ...settings.value.ccBoss.items[0], id: 9, ids: [9] });
        await w!.vm.$nextTick();
        await row(323).get('[data-solo] button').trigger('click');
        expect(h.setLayout).toHaveBeenCalledWith('ccBoss-9', L);
        expect(h.removeLayout).toHaveBeenCalledWith('ccBoss-g2');
    });

    it('the title switch is off by default and saves to the look', async () => {
        mountSec('ccParty');
        const box = w!.get('[data-title-on]');
        expect(box.text()).toContain('顯示「隊伍 CC」');
        expect(settings.value.ccParty.look.title).toBe(false);
        await box.trigger('click');
        expect(settings.value.ccParty.look.title).toBe(true);
    });

    it('adds a CC from the picker and marks the ones already there', async () => {
        condNameMap.value = { ...condNameMap.value, 999: '測試狀態 999' };
        mountSec('ccBoss');
        await w!.get('[data-add]').trigger('click');
        const picker = w!.get('[data-picker]');
        expect(picker.get('[data-pick="1164"]').classes()).toContain('added');
        await picker.get('[data-pick="999"]').trigger('click');
        expect(ids('ccBoss')).toEqual([1164, 1165, 1166, 323, 999]);
        expect(settings.value.ccBoss.items[4]).toMatchObject({ label: '測試狀態', ids: [999] });
        expect(w!.find('[data-picker]').exists()).toBe(false);
    });

    it('burst page shows the look only', () => {
        mountSec('burst');
        expect(w!.find('[data-size-px]').exists()).toBe(true);
        expect(w!.find('[data-item]').exists()).toBe(false);
        expect(w!.find('[data-add]').exists()).toBe(false);
    });
});

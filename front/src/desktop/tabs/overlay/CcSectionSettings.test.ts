// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';
import type { OverlayState } from '@/lib/overlayProtocol';
import { defaultOverlaySettings, type OverlaySettings } from '@/lib/overlaySettings';
import type { CcSectionId } from '@/lib/overlaySections';
import { condNameMap } from '@/store';
import { defaultFrameRec, frameField } from '@/lib/overlayFrames';

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
const blockEls = () => w!.findAll('[data-frame-block]');
const openLook = (i: number) => blockEls()[i].get('[data-frame-look-toggle]').trigger('click');
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

    describe('frame blocks', () => {
        const L = { enabled: true, anchor: 'tl' as const, x: 5, y: 0, width: 120, maxRows: 1 };
        const rec1 = defaultFrameRec('ccParty', 'group', 1);
        const withGroup = () => {
            state.value = baseState({ 'ccParty-g1': { ...L, order: ['476', '1225'], frame: frameField(rec1) } });
            mountSec('ccParty');
        };
        const lastFrame = () => JSON.parse(h.setLayout.mock.calls.at(-1)![1].frame);

        it('one block per frame, items split between them', () => {
            withGroup();
            const blocks = blockEls();
            expect(blocks).toHaveLength(2);
            expect(blocks[1].get('[data-frame-title]').text()).toBe('隊伍 CC 1');
            expect(blocks[1].find('[data-item="476"]').exists()).toBe(true);
            expect(blocks[1].find('[data-item="1225"]').exists()).toBe(true);
            expect(blocks[0].find('[data-item="476"]').exists()).toBe(false);
            expect(blocks[0].find('[data-item="680"]').exists()).toBe(true);
            expect(w!.find('[data-solo]').exists()).toBe(false);
        });

        it('look parts start collapsed; 自訂 copies the section look, back to follow clears it', async () => {
            withGroup();
            expect(blockEls()[1].find('[data-follow]').exists()).toBe(false);
            await openLook(1);
            const follow = blockEls()[1].get('[data-follow]');
            expect(blockEls()[1].find('[data-size-px]').exists()).toBe(false);
            await follow.findAll('[role="radio"]')[1].trigger('click');
            expect(h.setLayout.mock.calls.at(-1)![0]).toBe('ccParty-g1');
            expect(lastFrame().look).toEqual(settings.value.ccParty.look);
            expect(lastFrame().n).toBe(1);
        });

        it('back to follow sets look null', async () => {
            const rec = { ...rec1, look: settings.value.ccParty.look };
            state.value = baseState({ 'ccParty-g1': { ...L, order: ['476', '1225'], frame: frameField(rec) } });
            mountSec('ccParty');
            await openLook(1);
            expect(blockEls()[1].find('[data-size-px]').exists()).toBe(true);
            await blockEls()[1].get('[data-follow]').findAll('[role="radio"]')[0].trigger('click');
            expect(lastFrame().look).toBeNull();
        });

        it('↺ on a pulled frame restores its default record; main ↺ clears the title text', async () => {
            const rec = { ...rec1, name: '我的', titleOn: true };
            state.value = baseState({ 'ccParty-g1': { ...L, order: ['476', '1225'], frame: frameField(rec) } });
            mountSec('ccParty');
            await blockEls()[1].get('[data-frame-reset]').trigger('click');
            expect(lastFrame()).toEqual({ n: 1, name: '隊伍 CC 1', titleOn: null, look: null });
            settings.value.ccParty.look.titleText = '隊伍';
            await w!.vm.$nextTick();
            expect(blockEls()[0].get('[data-frame-title]').text()).toBe('隊伍');
            await blockEls()[0].get('[data-frame-reset]').trigger('click');
            expect(settings.value.ccParty.look.titleText).toBe('');
        });

        it('editing the title text renames the frame', async () => {
            withGroup();
            await openLook(1);
            const input = blockEls()[1].get('[data-title-text]');
            await input.setValue('輔助');
            await input.trigger('change');
            expect(lastFrame()).toMatchObject({ n: 1, name: '輔助', look: null });
        });

        it('用不到的格子 shows only for 依隊友排列', async () => {
            mountSec('ccParty');
            await openLook(0);
            expect(w!.find('[data-gap]').exists()).toBe(false);
            await w!.get('[data-arrange]').findAll('[role="radio"]')[1].trigger('click');
            expect(settings.value.ccParty.look.arrange).toBe('byMember');
            expect(w!.find('[data-gap]').exists()).toBe(true);
        });

        it('no 群組 / 大群 anywhere in the page text', async () => {
            withGroup();
            await openLook(0);
            await openLook(1);
            expect(w!.text()).not.toMatch(/群組|大群/);
        });

        it('burst still shows its pulled frames, without an item list', () => {
            state.value = baseState({ 'burst-900206': { ...L, frame: frameField(defaultFrameRec('burst', 'unit', 1)) } });
            mountSec('burst');
            expect(blockEls()).toHaveLength(2);
            expect(w!.find('[data-item]').exists()).toBe(false);
        });

        it('a frame without a record yet shows the default name', () => {
            state.value = baseState({ 'ccParty-g1': { ...L, order: ['476', '1225'] } });
            mountSec('ccParty');
            expect(blockEls()[1].get('[data-frame-title]').text()).toBe('隊伍 CC 1');
        });
    });

    it('the title switch is off by default and saves to the look', async () => {
        mountSec('ccParty');
        await openLook(0);
        const box = w!.get('[data-title-on]');
        expect(box.text()).toBe('顯示');
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

    it('burst page shows the look only', async () => {
        mountSec('burst');
        await openLook(0);
        expect(w!.find('[data-size-px]').exists()).toBe(true);
        expect(w!.find('[data-item]').exists()).toBe(false);
        expect(w!.find('[data-add]').exists()).toBe(false);
    });
});

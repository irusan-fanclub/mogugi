// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';
import type { OverlayState } from '@/lib/overlayProtocol';
import { defaultOverlaySettings, type OverlaySettings } from '@/lib/overlaySettings';
import { playerSkillIds, skillNameMap } from '@/store';

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

import CooldownSettings from './CooldownSettings.vue';

let w: VueWrapper | null = null;

beforeEach(() => {
    state.value = {
        locked: true, hotkey: '', hotkeyError: '', licensed: true, elevated: true, elevateError: '', hidden: false,
        visibleHotkey: '', visibleHotkeyError: '', layout: {}, gameFound: true,
    };
    settings.value = defaultOverlaySettings();
    skillNameMap.value = { 20018: '憤怒衝擊', 59005: '崩壞的波動', 59143: '召喚噩夢', 59123: '死亡準星', 50001: '怪物技能' };
    playerSkillIds.value = new Set([20018, 59005, 59143, 59123]);
    h.setLayout.mockClear(); h.removeLayout.mockClear();
});
afterEach(() => { w?.unmount(); w = null; });

const mountCd = () => (w = mount(CooldownSettings, { attachTo: document.body }));
const row = (id: number) => w!.get(`[data-item="${id}"]`);
const picks = () => w!.findAll('[data-picker] [data-pick]').map(p => Number(p.attributes('data-pick')));

describe('CooldownSettings', () => {
    it('skill picker lists player skills only; 秘法技能 keeps the 59000–59199 block', async () => {
        mountCd();
        await w!.get('[data-add]').trigger('click');
        expect(picks()).toEqual([20018, 59005, 59123, 59143]);
        const src = w!.get('[data-picker-source]').findAll('[role="radio"]');
        expect(src.map(r => r.text())).toEqual(['全部', '秘法技能']);
        await src[1].trigger('click');
        expect(picks()).toEqual([59005, 59123, 59143]);
        await w!.get('[data-picker-view]').findAll('[role="radio"]')[1].trigger('click');
        const sub = w!.get('[data-pick="59005"] .pid').text();
        expect(sub).toBe('聖詠者');
        await w!.get('[data-picker-view]').findAll('[role="radio"]')[0].trigger('click');
    });

    it('lists every skill when player skills could not be loaded (old db)', async () => {
        playerSkillIds.value = new Set();
        mountCd();
        await w!.get('[data-add]').trigger('click');
        expect(picks()).toEqual([20018, 50001, 59005, 59123, 59143]);
    });

    it('adds a skill with the default item and the body edits it', async () => {
        mountCd();
        await w!.get('[data-add]').trigger('click');
        await w!.get('[data-pick="20018"]').trigger('click');
        expect(settings.value.cooldown.items.map(i => i.skillId)).toEqual([59005, 59143, 59123, 20018]);
        await row(20018).get('[data-cd-sec]').setValue('45');
        await row(20018).get('[data-cd-sec]').trigger('change');
        await row(20018).findAll('[data-who] [role="radio"]').find(r => r.text() === '全部')!.trigger('click');
        await row(20018).get('[data-arcana-id="2"]').trigger('click');
        expect(settings.value.cooldown.items[3]).toMatchObject({ skillId: 20018, cooldownSec: 45, who: 'all', arcana: [2] });
        expect(row(20018).findAll('[data-soon]')).toHaveLength(2);
    });

    it('↺ restores the preset cooldown of a default skill', async () => {
        mountCd();
        await row(59005).get('.head').trigger('click');
        await row(59005).get('[data-cd-sec]').setValue('90');
        await row(59005).get('[data-cd-sec]').trigger('change');
        await row(59005).get('[data-reset]').trigger('click');
        expect(settings.value.cooldown.items[0]).toEqual({ skillId: 59005, cooldownSec: 180, ccId: 803, enabled: true, who: 'party', arcana: [] });
    });

    it('the switch toggles the item', async () => {
        mountCd();
        await row(59143).get('[role="switch"]').trigger('click');
        expect(settings.value.cooldown.items[1].enabled).toBe(false);
    });
});

// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';
import { defaultOverlaySettings, type OverlaySettings } from '@/lib/overlaySettings';
import { ICON_SIZE_PX } from '@/lib/overlaySections';

const settingsRef = () => settings;
const settings = ref<OverlaySettings>(defaultOverlaySettings());
vi.mock('../../overlay/overlayLink', () => ({
    get overlaySettings() { return settingsRef(); },
    updateOverlaySettings: (mut: (s: OverlaySettings) => void) => {
        const r = settingsRef();
        const next = JSON.parse(JSON.stringify(r.value)) as OverlaySettings;
        mut(next);
        r.value = next;
    },
}));

import GeneralSettings from './GeneralSettings.vue';
import SizeField from './SizeField.vue';

let w: VueWrapper | null = null;
beforeEach(() => { settings.value = defaultOverlaySettings(); });
afterEach(() => { w?.unmount(); w = null; });

describe('GeneralSettings', () => {
    it('scale slider writes overlaySettings.scale', async () => {
        w = mount(GeneralSettings);
        await w.get('[data-overlay-scale]').setValue('120');
        expect(settings.value.scale).toBe(120);
        expect(w.text()).toContain('120%');
    });

    it('colour inputs write general; 提醒顏色 ↺ restores the colours but not the panel', async () => {
        w = mount(GeneralSettings);
        await w.get('[data-color="warn"]').setValue('#112233');
        expect(settings.value.general.warn).toBe('#112233');
        await w.get('[data-general-bg]').setValue('#445566');
        await w.get('[data-general-alpha]').setValue('60');
        expect(settings.value.general.bg).toEqual({ color: '#445566', alpha: 60 });
        await w.get('[data-reset-colors]').trigger('click');
        expect(settings.value.general).toMatchObject({ warn: '#e8a33d', gone: '#e5534b', ok: '#5cc26a', bg: { color: '#445566', alpha: 60 } });
        await w.get('[data-reset-bg]').trigger('click');
        expect(settings.value.general.bg).toEqual({ color: '#0e1013', alpha: 0 });
    });
});

describe('SizeField options', () => {
    it('offers 特大 when the presets have xl, text presets give px', async () => {
        w = mount(SizeField, { props: { presets: ICON_SIZE_PX, min: 16, max: 96, modelValue: { size: 'xl', px: 52 } } });
        expect(w.findAll('[role="radio"]').map(r => r.text())).toEqual(['小', '中', '大', '特大', '自訂']);
        expect((w.get('[data-size-px]').element as HTMLInputElement).value).toBe('56');
        w.unmount();
        w = mount(SizeField, { props: { presets: { s: 1, m: 2, l: 3 }, min: 1, max: 9, modelValue: { size: 'm', px: 5 } } });
        expect(w.findAll('[role="radio"]').map(r => r.text())).toEqual(['小', '中', '大', '自訂']);
    });
});

describe('SizeField', () => {
    it('a preset shows its px disabled; 自訂 starts from it and enables the input', async () => {
        w = mount(SizeField, {
            props: {
                presets: ICON_SIZE_PX, min: 16, max: 96, modelValue: { size: 'm', px: 52 },
                'onUpdate:modelValue': (v: unknown) => w!.setProps({ modelValue: v }),
            },
        });
        const input = () => w!.get('[data-size-px]').element as HTMLInputElement;
        expect(input().value).toBe('36');
        expect(input().disabled).toBe(true);
        await w.findAll('[role="radio"]').find(r => r.text() === '自訂')!.trigger('click');
        expect(w.props('modelValue' as never)).toEqual({ size: 'c', px: 36 });
        expect(input().value).toBe('36');
        expect(input().disabled).toBe(false);
        await w.get('[data-size-px]').setValue('200');
        await w.get('[data-size-px]').trigger('change');
        expect(w.props('modelValue' as never)).toEqual({ size: 'c', px: 96 });
    });
});

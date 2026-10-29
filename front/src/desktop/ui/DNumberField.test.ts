// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DNumberField from './DNumberField.vue';

describe('DNumberField', () => {
    it('clamps to max on blur', async () => {
        const w = mount(DNumberField, { props: { modelValue: 1, min: 0, max: 65535 } });
        const input = w.get('input');
        await input.setValue('99999');
        await input.trigger('blur');
        expect(w.emitted('update:modelValue')!.at(-1)).toEqual([65535]);
    });
    it('clamps to min on blur', async () => {
        const w = mount(DNumberField, { props: { modelValue: 5, min: 1, max: 10 } });
        const input = w.get('input');
        await input.setValue('-4');
        await input.trigger('blur');
        expect(w.emitted('update:modelValue')!.at(-1)).toEqual([1]);
    });
});

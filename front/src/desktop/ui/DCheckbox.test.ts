// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DCheckbox from './DCheckbox.vue';
import DSwitch from './DSwitch.vue';

describe('DCheckbox', () => {
    it('indeterminate reports aria-checked=mixed', () => {
        const w = mount(DCheckbox, { props: { modelValue: false, indeterminate: true } });
        expect(w.get('[role=checkbox]').attributes('aria-checked')).toBe('mixed');
    });
    it('toggles on click', async () => {
        const w = mount(DCheckbox, { props: { modelValue: false } });
        await w.get('[role=checkbox]').trigger('click');
        expect(w.emitted('update:modelValue')![0]).toEqual([true]);
    });
    it('indeterminate click selects', async () => {
        const w = mount(DCheckbox, { props: { modelValue: false, indeterminate: true } });
        await w.get('[role=checkbox]').trigger('click');
        expect(w.emitted('update:modelValue')![0]).toEqual([true]);
    });
});

describe('DSwitch', () => {
    it('toggles and exposes aria-checked', async () => {
        const w = mount(DSwitch, { props: { modelValue: true } });
        const el = w.get('[role=switch]');
        expect(el.attributes('aria-checked')).toBe('true');
        await el.trigger('click');
        expect(w.emitted('update:modelValue')![0]).toEqual([false]);
    });
});

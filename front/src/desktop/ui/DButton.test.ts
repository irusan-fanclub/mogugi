// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DButton from './DButton.vue';
import DIconButton from './DIconButton.vue';
import DTextarea from './DTextarea.vue';
import DAlert from './DAlert.vue';

describe('DButton', () => {
    it('loading disables the button', () => {
        const w = mount(DButton, { props: { loading: true }, slots: { default: 'go' } });
        expect(w.get('button').attributes('disabled')).toBeDefined();
    });
    it('click emits click when enabled', async () => {
        const w = mount(DButton, { slots: { default: 'go' } });
        await w.get('button').trigger('click');
        expect(w.emitted('click')).toHaveLength(1);
    });
    it('aria-pressed only appears on toggle buttons', () => {
        const attr = (props: object) => mount(DButton, { props, slots: { default: 'go' } }).get('button').attributes('aria-pressed');
        expect(attr({})).toBeUndefined();
        expect(attr({ active: true })).toBe('true');
        expect(attr({ active: false })).toBe('false');
    });
});

describe('DIconButton', () => {
    it('uses title as aria-label and renders the mdi class', () => {
        const w = mount(DIconButton, { props: { icon: 'mdi-close', title: 'Close' } });
        expect(w.get('button').attributes('aria-label')).toBe('Close');
        expect(w.get('i').classes()).toContain('mdi-close');
    });
});

describe('DTextarea', () => {
    it('emits typed value', async () => {
        const w = mount(DTextarea, { props: { modelValue: '' } });
        await w.get('textarea').setValue('a\nb');
        expect(w.emitted('update:modelValue')![0]).toEqual(['a\nb']);
    });
});

describe('DAlert', () => {
    it('closable emits close', async () => {
        const w = mount(DAlert, { props: { kind: 'warn', closable: true }, slots: { default: 'x' } });
        await w.get('[data-close]').trigger('click');
        expect(w.emitted('close')).toHaveLength(1);
    });
});

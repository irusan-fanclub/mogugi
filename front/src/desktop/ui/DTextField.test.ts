// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DTextField from './DTextField.vue';

describe('DTextField', () => {
    it('clear button emits empty string', async () => {
        const w = mount(DTextField, { props: { modelValue: 'abc', clearable: true } });
        await w.get('[data-clear]').trigger('click');
        expect(w.emitted('update:modelValue')![0]).toEqual(['']);
    });
    it('hides clear button when empty', () => {
        const w = mount(DTextField, { props: { modelValue: '', clearable: true } });
        expect(w.find('[data-clear]').exists()).toBe(false);
    });
    it('emits typed value', async () => {
        const w = mount(DTextField, { props: { modelValue: '' } });
        await w.get('input').setValue('x');
        expect(w.emitted('update:modelValue')![0]).toEqual(['x']);
    });
});

describe('DTextField attrs and a11y', () => {
    it('passes aria-label to the input and class to the wrapper', () => {
        const w = mount(DTextField, { props: { modelValue: '' }, attrs: { 'aria-label': 'name', class: 'x' } });
        expect(w.get('input').attributes('aria-label')).toBe('name');
        expect(w.classes()).toContain('x');
        expect(w.attributes('aria-label')).toBeUndefined();
    });
    it('error sets aria-invalid and aria-describedby', () => {
        const w = mount(DTextField, { props: { modelValue: '', error: 'bad' } });
        const input = w.get('input');
        expect(input.attributes('aria-invalid')).toBe('true');
        const id = input.attributes('aria-describedby')!;
        expect(w.get('.msg').attributes('id')).toBe(id);
    });
    it('NumberField and Textarea forward attrs and aria-invalid', async () => {
        const { default: N } = await import('./DNumberField.vue');
        const { default: T } = await import('./DTextarea.vue');
        const n = mount(N, { props: { modelValue: 1, error: 'e' }, attrs: { 'aria-label': 'n' } });
        expect(n.get('input').attributes('aria-label')).toBe('n');
        expect(n.get('input').attributes('aria-invalid')).toBe('true');
        const t = mount(T, { props: { modelValue: '', error: 'e' }, attrs: { name: 'nm' } });
        expect(t.get('textarea').attributes('name')).toBe('nm');
        expect(t.get('textarea').attributes('aria-invalid')).toBe('true');
    });
});

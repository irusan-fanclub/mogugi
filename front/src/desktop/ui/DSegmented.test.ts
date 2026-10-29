// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DSegmented from './DSegmented.vue';

const options = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }];

describe('DSegmented', () => {
    it('emits value when clicking another option', async () => {
        const w = mount(DSegmented, { props: { modelValue: 'a', options } });
        await w.findAll('button')[1].trigger('click');
        expect(w.emitted('update:modelValue')![0]).toEqual(['b']);
    });
    it('does not emit when clicking the selected option', async () => {
        const w = mount(DSegmented, { props: { modelValue: 'a', options } });
        await w.findAll('button')[0].trigger('click');
        expect(w.emitted('update:modelValue')).toBeUndefined();
    });
});

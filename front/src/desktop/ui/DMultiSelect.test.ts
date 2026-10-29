// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import DMultiSelect from './DMultiSelect.vue';

const items = [
    { value: 1, title: 'abc one' },
    { value: 2, title: 'xyz two' },
    { value: 3, title: 'abcd three' },
];
let w: VueWrapper | null = null;
afterEach(() => { w?.unmount(); w = null; document.body.innerHTML = ''; });
const mountMs = (props: Record<string, unknown> = {}) =>
    (w = mount(DMultiSelect, { props: { modelValue: [], items, ...props }, attachTo: document.body }));
const input = () => document.querySelector<HTMLInputElement>('input')!;
const opts = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
async function type(text: string) {
    input().value = text;
    input().dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
}

describe('DMultiSelect', () => {
    it('typing filters the list', async () => {
        mountMs();
        await type('abc');
        expect(opts().map(o => o.textContent?.trim())).toEqual(['abc one', 'abcd three']);
    });

    it('clicking a chip x removes it', async () => {
        mountMs({ modelValue: [1, 2] });
        expect(document.querySelectorAll('[data-chip]')).toHaveLength(2);
        document.querySelector<HTMLElement>('[data-chip-remove]')!.click();
        expect(w!.emitted('update:modelValue')![0]).toEqual([[2]]);
    });

    it('multi pick toggles and respects max', async () => {
        mountMs({ modelValue: [1], max: 2 });
        await type('');
        input().click();
        await nextTick();
        opts()[1].click();
        expect(w!.emitted('update:modelValue')![0]).toEqual([[1, 2]]);
        await w!.setProps({ modelValue: [1, 2] });
        opts()[2].click();
        expect(w!.emitted('update:modelValue')).toHaveLength(1);
    });

    it('max=1 replaces the selection and closes', async () => {
        mountMs({ modelValue: [1], max: 1 });
        input().click();
        await nextTick();
        opts()[1].click();
        await nextTick();
        expect(w!.emitted('update:modelValue')![0]).toEqual([[2]]);
        expect(opts()).toHaveLength(0);
    });

    it('Enter with no match emits submit with the typed text; with a match it picks', async () => {
        mountMs({ max: 1 });
        await type('777');
        input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await nextTick();
        expect(w!.emitted('submit')![0]).toEqual(['777']);
        await type('xyz');
        input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(w!.emitted('update:modelValue')![0]).toEqual([[2]]);
    });

    it('Enter prefers an exact id over the highlighted item, and submits an unknown number', async () => {
        const its = [{ value: 5, title: 'id 2 in title' }, { value: 2, title: 'plain' }];
        mountMs({ max: 1, items: its });
        await type('2');
        input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(w!.emitted('update:modelValue')![0]).toEqual([[2]]);
        await type('9');
        input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        expect(w!.emitted('submit')![0]).toEqual(['9']);
    });

    it('clearable x empties the selection', async () => {
        mountMs({ modelValue: [1, 2], clearable: true });
        document.querySelector<HTMLElement>('[data-clear]')!.click();
        expect(w!.emitted('update:modelValue')![0]).toEqual([[]]);
    });
});

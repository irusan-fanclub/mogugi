// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import ItemPicker from './ItemPicker.vue';

let w: VueWrapper | null = null;
afterEach(() => { w?.unmount(); w = null; });

const ITEMS = [
    { id: 1164, name: '減少防禦/保護' }, { id: 1165, name: '減少魔法防禦' }, { id: 2116, name: '其他' }, { id: 680, name: '戰場的序曲' },
];
const mountPicker = (extra = {}) => (w = mount(ItemPicker, {
    props: {
        title: '新增 CC', items: ITEMS, iconOf: (id: number) => `/icons/cc/${id}.png`,
        markOf: (id: number) => (id === 1165 ? 'added' : id === 680 ? 'cur' : ''), ...extra,
    },
}));
const shown = () => w!.findAll('[data-pick]').map(p => Number(p.attributes('data-pick')));

describe('ItemPicker', () => {
    it('defaults to the icon grid; search matches id substrings; added items emit nothing', async () => {
        mountPicker();
        expect(w!.find('[data-picker-grid]').exists()).toBe(true);
        await w!.get('[data-picker-q]').setValue('116');
        expect(shown()).toEqual([1164, 1165, 2116]);
        await w!.get('[data-pick="1165"]').trigger('click');
        expect(w!.emitted('pick')).toBeUndefined();
        await w!.get('[data-pick="1164"]').trigger('click');
        expect(w!.emitted('pick')).toEqual([[1164]]);
    });

    it('search matches name substrings; hover shows name and id in the footer', async () => {
        mountPicker();
        await w!.get('[data-picker-q]').setValue('防禦');
        expect(shown()).toEqual([1164, 1165]);
        await w!.get('[data-pick="1164"]').trigger('mouseenter');
        expect(w!.get('[data-picker-foot]').text()).toBe('減少防禦/保護（1164）');
    });

    it('list view is remembered for the next picker; marks show as text', async () => {
        mountPicker();
        await w!.get('[data-picker-view]').findAll('[role="radio"]')[1].trigger('click');
        w!.unmount();
        mountPicker();
        expect(w!.find('[data-picker-list]').exists()).toBe(true);
        expect(w!.get('[data-pick="1165"]').text()).toContain('已加入');
        expect(w!.get('[data-pick="680"]').text()).toContain('使用中');
        await w!.get('[data-picker-view]').findAll('[role="radio"]')[0].trigger('click');
    });

    it('source switch emits update:source; 關閉 emits close', async () => {
        mountPicker({ sources: [{ value: 'cc', label: 'CC' }, { value: 'skill', label: '技能' }], source: 'cc' });
        await w!.get('[data-picker-source]').findAll('[role="radio"]')[1].trigger('click');
        expect(w!.emitted('update:source')).toEqual([['skill']]);
        await w!.get('[data-picker-close]').trigger('click');
        expect(w!.emitted('close')).toHaveLength(1);
    });
});

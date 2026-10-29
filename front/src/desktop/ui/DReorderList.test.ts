// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import DReorderList from './DReorderList.vue';

const items = [
    { key: 'p', label: 'pin' },
    { key: 'a', label: 'A', checked: true },
    { key: 'b', label: 'B', checked: false },
];
let w: VueWrapper | null = null;
afterEach(() => { w?.unmount(); w = null; });
const rows = () => w!.findAll('.row');

describe('DReorderList', () => {
    it('dragging item 2 over item 0 emits reorder(2,0)', async () => {
        w = mount(DReorderList, { props: { items } });
        await rows()[2].trigger('dragstart');
        await rows()[0].trigger('dragover');
        expect(w.emitted('reorder')).toEqual([[2, 0]]);
    });

    it('a normal move emits from/to and follows the item', async () => {
        w = mount(DReorderList, { props: { items: [...items, { key: 'c', label: 'C' }] } });
        await rows()[3].trigger('dragstart');
        await rows()[1].trigger('dragover');
        await rows()[1].trigger('dragover');
        expect(w.emitted('reorder')).toEqual([[3, 1]]);
    });

    it('checkable rows emit toggle(key)', async () => {
        w = mount(DReorderList, { props: { items, checkable: true } });
        await rows()[2].find('[role="checkbox"]').trigger('click');
        expect(w.emitted('toggle')).toEqual([['b']]);
        expect(rows()[1].find('[role="checkbox"]').attributes('aria-checked')).toBe('true');
    });
});

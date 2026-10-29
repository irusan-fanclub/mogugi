// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DTable from './DTable.vue';
import DPaginator from './DPaginator.vue';
import DDateTimeField from './DDateTimeField.vue';

const columns = [
    { key: 'a', title: 'A', sortable: true },
    { key: 'b', title: 'B' },
];
const rows = [{ id: '1', a: 'x', b: 'y' }, { id: '2', a: 'z', b: 'w' }];

describe('DTable', () => {
    it('first click on a sortable header emits desc, second asc', async () => {
        const w = mount(DTable, { props: { columns, rows, rowKey: 'id', sortBy: [] as never[] } });
        await w.get('th[data-col="a"]').trigger('click');
        expect(w.emitted('update:sortBy')![0]).toEqual([[{ key: 'a', order: 'desc' }]]);
        await w.setProps({ sortBy: [{ key: 'a', order: 'desc' }] });
        await w.get('th[data-col="a"]').trigger('click');
        expect(w.emitted('update:sortBy')![1]).toEqual([[{ key: 'a', order: 'asc' }]]);
    });
    it('sortable headers are focusable and sort on Enter/Space; others are not', async () => {
        const w = mount(DTable, { props: { columns, rows, rowKey: 'id' } });
        expect(w.get('th[data-col="a"]').attributes('tabindex')).toBe('0');
        expect(w.get('th[data-col="b"]').attributes('tabindex')).toBeUndefined();
        await w.get('th[data-col="a"]').trigger('keydown', { key: 'Enter' });
        await w.get('th[data-col="a"]').trigger('keydown', { key: ' ' });
        expect(w.emitted('update:sortBy')).toHaveLength(2);
        await w.get('th[data-col="b"]').trigger('keydown', { key: 'Enter' });
        expect(w.emitted('update:sortBy')).toHaveLength(2);
    });
    it('multiSort: click cycles asc, desc, off; Shift+click stacks keys', async () => {
        const cols = [{ key: 'a', title: 'A', sortable: true }, { key: 'b', title: 'B', sortable: true }];
        const w = mount(DTable, { props: { columns: cols, rows, rowKey: 'id', multiSort: true, sortBy: [] as never[] } });
        const last = () => w.emitted('update:sortBy')!.at(-1)![0];
        await w.get('th[data-col="a"]').trigger('click');
        expect(last()).toEqual([{ key: 'a', order: 'asc' }]);
        await w.setProps({ sortBy: [{ key: 'a', order: 'asc' }] });
        await w.get('th[data-col="b"]').trigger('click', { shiftKey: true });
        expect(last()).toEqual([{ key: 'a', order: 'asc' }, { key: 'b', order: 'asc' }]);
        await w.setProps({ sortBy: [{ key: 'a', order: 'asc' }, { key: 'b', order: 'asc' }] });
        expect(w.get('th[data-col="b"] .rank').text()).toBe('2');
        await w.get('th[data-col="a"]').trigger('click', { shiftKey: true });
        expect(last()).toEqual([{ key: 'a', order: 'desc' }, { key: 'b', order: 'asc' }]);
        await w.get('th[data-col="b"]').trigger('click');
        expect(last()).toEqual([{ key: 'b', order: 'desc' }]);
        await w.setProps({ sortBy: [{ key: 'b', order: 'desc' }] });
        await w.get('th[data-col="b"]').trigger('click');
        expect(last()).toEqual([]);
    });
    it('non-sortable header emits nothing', async () => {
        const w = mount(DTable, { props: { columns, rows, rowKey: 'id' } });
        await w.get('th[data-col="b"]').trigger('click');
        expect(w.emitted('update:sortBy')).toBeUndefined();
    });
    it('renders cell slots, expanded slot and emits row-contextmenu', async () => {
        const w = mount(DTable, {
            props: { columns, rows, rowKey: 'id', expandedKeys: ['2'] },
            slots: { 'cell-b': '<template #cell-b="{ row }">B:{{ row.b }}</template>', expanded: '<template #expanded="{ row }">E{{ row.id }}</template>' },
        });
        expect(w.findAll('[data-cell="b"]').map(c => c.text())).toEqual(['B:y', 'B:w']);
        expect(w.findAll('[data-expanded]')).toHaveLength(1);
        expect(w.get('[data-expanded]').text()).toBe('E2');
        await w.findAll('[data-row]')[1].trigger('contextmenu');
        expect(w.emitted('row-contextmenu')![0][0]).toEqual(rows[1]);
    });
});

describe('DPaginator', () => {
    it('hidden for one page; windows long ranges; emits page', async () => {
        expect(mount(DPaginator, { props: { page: 1, pageCount: 1 } }).find('nav').exists()).toBe(false);
        const w = mount(DPaginator, { props: { page: 10, pageCount: 20 } });
        expect(w.findAll('.pg:not([data-prev]):not([data-next]), .gap').map(b => b.text())).toEqual(['1', '…', '9', '10', '11', '…', '20']);
        await w.get('[data-next]').trigger('click');
        expect(w.emitted('update:page')![0]).toEqual([11]);
    });
});

describe('DDateTimeField', () => {
    it('blurred shows the date, focused switches to datetime-local', async () => {
        const w = mount(DDateTimeField, { props: { modelValue: '2026-10-21T10:30', label: '從' }, attachTo: document.body });
        const input = w.get('input');
        expect((input.element as HTMLInputElement).value).toBe('2026-10-21');
        await input.trigger('focus');
        expect((w.get('input').element as HTMLInputElement).type).toBe('datetime-local');
        await w.get('input').trigger('blur');
        expect((w.get('input').element as HTMLInputElement).type).toBe('text');
        w.unmount();
    });
    it('clear button empties the value', async () => {
        const w = mount(DDateTimeField, { props: { modelValue: '2026-10-21T10:30' } });
        await w.get('[data-clear]').trigger('click');
        expect(w.emitted('update:modelValue')![0]).toEqual(['']);
    });
    it('typing emits the datetime-local string', async () => {
        const w = mount(DDateTimeField, { props: { modelValue: '' }, attachTo: document.body });
        await w.get('input').trigger('focus');
        await w.get('input').setValue('2026-10-21T10:30');
        expect(w.emitted('update:modelValue')![0]).toEqual(['2026-10-21T10:30']);
        w.unmount();
    });
});

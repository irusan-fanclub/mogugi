// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import CcIconGrid from './CcIconGrid.vue';
import { condNameMap } from '@/store';

beforeEach(() => { condNameMap.value = { 10: '崩壞 1' }; });

describe('CcIconGrid', () => {
    it('titles icons 名稱 編號 and emits pick', async () => {
        const w = mount(CcIconGrid, { props: { ids: [10, 11] } });
        const b = w.findAll('.cc-btn');
        expect(b[0].attributes('title')).toBe('崩壞 10');
        await b[1].trigger('click');
        expect(w.emitted('pick')![0][0]).toBe(11);
    });
    it('emits menu on right-click and reorder on drag only when draggable', async () => {
        const w = mount(CcIconGrid, { props: { ids: [10, 11, 12], draggable: true } });
        const b = w.findAll('.cc-btn');
        await b[1].trigger('contextmenu');
        expect(w.emitted('menu')![0][0]).toBe(11);
        await b[2].trigger('dragstart');
        await b[0].trigger('dragover');
        expect(w.emitted('reorder')![0]).toEqual([2, 0]);
        const still = mount(CcIconGrid, { props: { ids: [10, 11] } });
        expect(still.find('.cc-btn').attributes('draggable')).toBeUndefined();
        await still.findAll('.cc-btn')[1].trigger('dragstart');
        await still.findAll('.cc-btn')[0].trigger('dragover');
        expect(still.emitted('reorder')).toBeUndefined();
    });
    it('shows the empty text only when empty', () => {
        expect(mount(CcIconGrid, { props: { ids: [], emptyText: '沒有' } }).text()).toBe('沒有');
        expect(mount(CcIconGrid, { props: { ids: [1], emptyText: '沒有' } }).text()).toBe('');
    });
});

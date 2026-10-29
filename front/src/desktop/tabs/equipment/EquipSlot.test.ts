// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import EquipSlot from './EquipSlot.vue';
import type { BoardCell } from '@/lib/equipBoard';

const cell = (id: number, name: string): BoardCell => ({
    region: 'main', pocket: 3, label: '頭', tall: false, empty: false,
    entry: { item: { id }, name, brief: '' } as unknown as BoardCell['entry'],
});

describe('EquipSlot', () => {
    it('drops the icon once it fails to load, and keeps the full name in a title', async () => {
        const w = mount(EquipSlot, { props: { cell: cell(1, '很長很長的裝備名稱') } });
        await w.get('img.ico').trigger('error');
        expect(w.find('img.ico').exists()).toBe(false);
        expect(w.get('.name').attributes('title')).toBe('很長很長的裝備名稱');
    });

    it('tries the icon again for a different item', async () => {
        const w = mount(EquipSlot, { props: { cell: cell(1, 'a') } });
        await w.get('img.ico').trigger('error');
        await w.setProps({ cell: cell(2, 'b') });
        expect(w.get('img.ico').attributes('src')).toBe('/icons/item/2.png');
    });
});

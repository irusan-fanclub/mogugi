// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MoveMenu from './MoveMenu.vue';

const blocks = [{ id: 'ccParty', name: '隊伍 CC' }, { id: 'ccParty-g1', name: '隊伍 CC 1' }];
const mk = (p: Partial<{ canUp: boolean; canDown: boolean; canNew: boolean }> = {}) => mount(MoveMenu, {
    props: { blocks, current: 'ccParty', canUp: true, canDown: true, canNew: true, ...p }, attachTo: document.body,
});

describe('MoveMenu', () => {
    it('往前 is disabled when it cannot go up; the current block is disabled and marked', async () => {
        const w = mk({ canUp: false });
        expect(w.find('[data-move-menu]').exists()).toBe(false);
        await w.get('[data-move]').trigger('click');
        expect(w.get('[data-move-up]').attributes('disabled')).toBeDefined();
        expect(w.get('[data-move-down]').attributes('disabled')).toBeUndefined();
        expect(w.get('[data-move-to="ccParty"]').text()).toBe('隊伍 CC（目前）');
        expect(w.get('[data-move-to="ccParty"]').attributes('disabled')).toBeDefined();
        w.unmount();
    });

    it('emits the target and closes', async () => {
        const w = mk();
        await w.get('[data-move]').trigger('click');
        await w.get('[data-move-to="ccParty-g1"]').trigger('click');
        expect(w.emitted('move')![0]).toEqual([{ frame: 'ccParty-g1' }]);
        expect(w.find('[data-move-menu]').exists()).toBe(false);
        await w.get('[data-move]').trigger('click');
        await w.get('[data-move-new]').trigger('click');
        await w.get('[data-move]').trigger('click');
        await w.get('[data-move-down]').trigger('click');
        expect(w.emitted('move')!.slice(1)).toEqual([['new'], [{ step: 1 }]]);
        w.unmount();
    });

    it('新的框 is disabled when it cannot start a frame', async () => {
        const w = mk({ canNew: false });
        await w.get('[data-move]').trigger('click');
        expect(w.get('[data-move-new]').attributes('disabled')).toBeDefined();
        await w.get('[data-move-new]').trigger('click');
        expect(w.emitted('move')).toBeUndefined();
        w.unmount();
    });

    it('closes on a click outside', async () => {
        const w = mk();
        await w.get('[data-move]').trigger('click');
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        await w.vm.$nextTick();
        expect(w.find('[data-move-menu]').exists()).toBe(false);
        w.unmount();
    });
});

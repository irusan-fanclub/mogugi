// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CooldownOverlay from './CooldownOverlay.vue';
import { defaultOverlaySettings } from '@/lib/overlaySettings';

const settings = defaultOverlaySettings().cooldown;
const row = (id: string, remaining: number, isSelf = false) => ({ id, name: id, skillId: 59005, remaining, isSelf });

describe('CooldownOverlay', () => {
    it('masks the elapsed fraction of the cooldown', () => {
        const w = mount(CooldownOverlay, { props: { rows: [row('a', 90)], settings, maxRows: 6 } });
        expect(w.find('[data-mask]').attributes('style')).toContain('180deg');
    });

    it('a ready row has no mask, the ready class and 好了', () => {
        const w = mount(CooldownOverlay, { props: { rows: [row('a', 0)], settings, maxRows: 6 } });
        expect(w.find('[data-mask]').exists()).toBe(false);
        expect(w.find('[data-cd-icon]').classes()).toContain('ready');
        expect(w.text()).toContain('好了');
    });

    it('draws at most maxRows rows', () => {
        const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map(i => row(i, 10));
        const w = mount(CooldownOverlay, { props: { rows, settings, maxRows: 3 } });
        expect(w.findAll('[data-cd-row]')).toHaveLength(3);
    });

    it('marks the owner row', () => {
        const w = mount(CooldownOverlay, { props: { rows: [row('a', 10, true), row('b', 10)], settings, maxRows: 6 } });
        expect(w.findAll('[data-cd-row]').map(r => r.classes().includes('self'))).toEqual([true, false]);
    });
});

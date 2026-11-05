// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import DpsOverlay from './DpsOverlay.vue';
import { defaultDpsLook, dpsFontPx } from '@/lib/overlaySections';
import type { DpsOverlayVM } from '@/lib/overlayModel';

const vm: DpsOverlayVM = {
    boss: { name: 'Boss', hpPct: 42.5, life: 3.14e9 }, fightSec: 65, partyDps: 1000,
    rows: [{ id: 'a', name: 'A', dps: 5000, total: 9000, share: 0.5, isSelf: true }],
};

describe('DpsOverlay', () => {
    it('shows no rank', () => {
        // The party DPS line (on by default) prints "1.00K", which would match "1.".
        const look = defaultDpsLook();
        look.top.partyDps = false;
        const w = mount(DpsOverlay, { props: { vm, look, rowsMax: 5 } });
        expect(w.text()).not.toContain('1.');
    });

    it('hpLeft shows the abbreviated remaining life', () => {
        const look = defaultDpsLook();
        look.top.hpLeft = true;
        const w = mount(DpsOverlay, { props: { vm, look, rowsMax: 5 } });
        expect(w.find('[data-top]').text()).toContain('3.14B');
    });

    it('boss off hides the name, hp percent stays', () => {
        const look = defaultDpsLook();
        look.top.boss = false;
        const w = mount(DpsOverlay, { props: { vm, look, rowsMax: 5 } });
        expect(w.text()).not.toContain('Boss');
        expect(w.find('[data-top]').text()).toContain('42.5%');
    });

    it('font size follows the look, rows follow rowsMax', () => {
        const look = { ...defaultDpsLook(), font: 'c' as const, fpx: 20 };
        const rows = Array.from({ length: 4 }, (_, i) => ({ ...vm.rows[0], id: 'r' + i }));
        const w = mount(DpsOverlay, { props: { vm: { ...vm, rows }, look, rowsMax: 2 } });
        expect(w.find('.ov-dps').attributes('style')).toContain(`font-size: ${dpsFontPx(look)}px`);
        expect(w.findAll('[data-row]')).toHaveLength(2);
    });
});

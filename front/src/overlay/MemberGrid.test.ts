// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import MemberGrid from './MemberGrid.vue';
import type { GridRow } from '@/lib/memberGrid';
import type { TileVM } from '@/lib/overlayTiles';
import { defaultCcSection } from '@/lib/overlaySections';

const tile = (key: string, holderId: string): TileVM => ({
    key, holderId, label: '', icon: { kind: 'cc', id: 1 }, sec: '', state: 'ok', hl: false, faint: false, mask: 0,
    isSelf: false, itemLabel: '', holderName: holderId, fixedLabel: false,
});
const rows: GridRow[] = ['a', 'b'].map(h => ({ holderId: h, name: h, cells: [tile('1', h), tile('2', h), tile('3', h)] }));
const look = defaultCcSection('ccParty').look;
const mk = (o: Record<string, unknown> = {}) =>
    mount(MemberGrid, { props: { rows, px: 36, dim: 100, look, ...o } });

describe('MemberGrid', () => {
    it('hides lifted columns and re-counts the grid', () => {
        const w = mk({ editing: true, lifted: ['2'] });
        expect(w.findAll('[data-tile-key="2"]')).toHaveLength(0);
        expect(w.get('.ov-members').attributes('style')).toContain('repeat(2, max-content)');
        expect(w.findAll('[data-member-row]')[0].findAll('[data-cell]')).toHaveLength(2);
    });

    it('draws the column bar only while an insert place is given, at that column line', () => {
        expect(mk().find('[data-col-bar]').exists()).toBe(false);
        expect(mk({ insertAt: 1 }).get('[data-col-bar]').attributes('style')).toContain('3 / 3');
        expect(mk({ insertAt: 9 }).get('[data-col-bar]').attributes('style')).toContain('5 / 5');
        expect(mk({ insertAt: 1, lifted: ['1'] }).get('[data-col-bar]').attributes('style')).toContain('3 / 3');
    });

    it('relays tile presses only while editing', async () => {
        const w = mk({ editing: true });
        await w.get('[data-tile-key="3"]').trigger('pointerdown');
        expect(w.emitted('tile-down')?.[0][0]).toBe('3');
        const idle = mk();
        await idle.get('[data-tile-key="3"]').trigger('pointerdown');
        expect(idle.emitted('tile-down')).toBeUndefined();
    });
});

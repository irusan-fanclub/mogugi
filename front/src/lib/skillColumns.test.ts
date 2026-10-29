import { describe, it, expect } from 'vitest';
import { DETAIL_COLUMNS, mergeColumnOrder, visibleColumns } from './skillColumns';

const keys = DETAIL_COLUMNS.map(c => c.key);

describe('skillColumns', () => {
    it('declares the 16 columns', () => {
        expect(DETAIL_COLUMNS).toHaveLength(16);
        expect(DETAIL_COLUMNS[0]).toEqual({ key: 'hitsPerMin', label: '每分鐘命中數', width: 88 });
        expect(DETAIL_COLUMNS[15].width).toBe(300);
    });
    it('uses declared order when nothing is saved', () => {
        expect(mergeColumnOrder([])).toEqual(keys);
    });
    it('keeps the saved order and drops unknown keys', () => {
        const saved = keys.filter(k => k !== 'avg').reverse();
        const out = mergeColumnOrder([...saved, 'bogus']);
        expect(out.filter(k => k !== 'avg')).toEqual(saved);
        expect(out).not.toContain('bogus');
    });
    it('inserts a new column after its declared predecessor', () => {
        const out = mergeColumnOrder(['critRate', 'castCount', 'critCount']);
        // normalCount is declared after critCount; avg after critRate
        expect(out.indexOf('normalCount')).toBe(out.indexOf('critCount') + 1);
        expect(out.indexOf('avg')).toBe(out.indexOf('critRate') + 1);
        expect(out).toHaveLength(16);
    });
    it('filters hidden columns', () => {
        expect(visibleColumns(['a', 'b', 'c'], new Set(['b']))).toEqual(['a', 'c']);
    });
});

import { describe, it, expect } from 'vitest';
import { listPcEntities, sortedConditions, sortedEquip, bodyText, stripId } from './entityView';

describe('entityView', () => {
    it('lists only PCs sorted by name', () => {
        const m = { a: { isPC: true, name: 'b' }, b: { isPC: false, name: 'a' }, c: { isPC: true, name: 'a' } } as never;
        expect(listPcEntities(m).map(e => e.name)).toEqual(['a', 'b']);
    });
    it('sorts conditions by CCId and equipment by pocket', () => {
        expect(sortedConditions({ conditionMap: { 1: { CCId: 9 }, 2: { CCId: 3 } } } as never).map(c => c.CCId)).toEqual([3, 9]);
        expect(sortedEquip({ equipItemMap: { 1: { PocketType: 5 }, 2: { PocketType: 2 } } } as never).map(c => c.PocketType)).toEqual([2, 5]);
    });
    it('formats body ratios', () => {
        expect(bodyText({ Height: 1, Weight: 0.5, Upper: 1.234, Lower: 0 })).toBe('h: 1.00 w: 0.50 u: 1.23 l: 0.00');
    });
    it('stripId', () => {
        expect(stripId('人類 8001', '?')).toBe('人類');
        expect(stripId(undefined, '?')).toBe('?');
    });
});

import { describe, it, expect } from 'vitest';
import { itemName, makeTooltipDeps, asHolder } from './tooltipDeps';

describe('tooltipDeps', () => {
    it('itemName strips the trailing id', () => {
        expect(itemName({ 5: '劍 5' }, 5)).toBe('劍');
        expect(itemName({ 6: '魔法 粉 6' }, 6)).toBe('魔法 粉');
    });
    it('itemName falls back for unknown ids', () => {
        expect(itemName({}, 9)).toBe('Item 9');
    });
    it('makeTooltipDeps wires maps and itemName', () => {
        const d = makeTooltipDeps({
            itemNameMap: { 1: '盾 1' }, enchantNameMap: { 2: 'x' }, enchantInfoMap: {}, metalwareMap: {},
            manualFormMap: {}, itemUpgradeMap: {}, itemDescMap: { 3: 'd' },
        });
        expect(d.itemName(1)).toBe('盾');
        expect(d.enchantNameMap[2]).toBe('x');
        expect(d.itemDescMap[3]).toBe('d');
    });
    it('asHolder fills entity and master', () => {
        const h = asHolder({ id: 1 } as never);
        expect(h.entity).toBe('');
        expect(h.master).toBe('');
        expect(asHolder({ id: 1 } as never, 'me', 'm').entity).toBe('me');
    });
});

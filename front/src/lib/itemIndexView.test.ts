import { describe, it, expect } from 'vitest';
import type { Holder } from './itemIndex';
import { makeTooltipDeps } from './tooltipDeps';
import {
    buildRows, containerText, csvFileName, distinct, metalwareText, searchError, storageText, ITEM_COLUMNS,
    parseVisibleCols, DEFAULT_COLS,
} from './itemIndexView';

const deps = makeTooltipDeps({
    itemNameMap: { 1: '長劍 1', 2: '背包 2', 3: '藥水 3' },
    enchantNameMap: {}, enchantInfoMap: {},
    metalwareMap: { 7: { name: '銳利', init: 0, per: 1, max: 20, standard: 1, isFloat: false, subDesc: '增加' } },
    manualFormMap: {}, itemUpgradeMap: {}, itemDescMap: {},
});
const H = (o: Partial<Holder>): Holder => ({
    id: 1, entity: 'A', master: 'M', qty: 1, storage: 'inventory', container: 'inv', x: 0, y: 0, ...o,
});
const HOLDERS = [
    H({ id: 1, entity: 'A' }),
    H({ id: 123, entity: 'B', master: 'N', storage: 'bank' }),
    H({ id: 3, entity: 'C', storage: 'beauty' }),
];
const base = { query: '', entity: [], master: [], storage: [], excludes: [], deps };

describe('itemIndexView', () => {
    it('invalid regex gives an error message and no rows', () => {
        expect(searchError('/劍[/')).toContain('正則式無效');
        expect(buildRows(HOLDERS, { ...base, query: '/劍[/' })).toEqual([]);
        expect(searchError('劍')).toBe('');
    });
    it('digits match only the item id', () => {
        const rows = buildRows(HOLDERS, { ...base, query: '123' });
        expect(rows.map(r => r.itemId)).toEqual([123]);
    });
    it('text and regex match the display name', () => {
        expect(buildRows(HOLDERS, { ...base, query: '長劍' }).map(r => r.entity)).toEqual(['A']);
        expect(buildRows(HOLDERS, { ...base, query: '/長.|藥/' }).map(r => r.entity)).toEqual(['A', 'C']);
    });
    it('excluding an entity removes its rows; filters AND together', () => {
        const rows = buildRows(HOLDERS, { ...base, excludes: [{ col: 'entity', value: 'A' }] });
        expect(rows.map(r => r.entity)).toEqual(['B', 'C']);
        expect(buildRows(HOLDERS, { ...base, master: ['N'], storage: ['銀行'] }).map(r => r.entity)).toEqual(['B']);
        expect(buildRows(HOLDERS, { ...base, entity: ['A', 'C'], excludes: [{ col: 'storage', value: '美容室' }] })
            .map(r => r.entity)).toEqual(['A']);
        expect(buildRows(HOLDERS, { ...base, excludes: [{ col: 'item', value: '長劍' }] }).map(r => r.entity))
            .toEqual(['B', 'C']);
    });
    it('rows carry display fields and a unique rid', () => {
        const rows = buildRows([H({ pocket: undefined, metalware: [{ id: 7, level: 3 }] })], base);
        expect(rows[0]).toMatchObject({ rid: 0, item: '長劍', pos: '(0,0)', pocket: '', metalware: '銳利 3', storage: '物品欄' });
    });
    it('text helpers', () => {
        expect(storageText(H({ storage: 'bank' }))).toBe('銀行');
        expect(storageText(H({ storage: 'x' }))).toBe('x');
        expect(metalwareText(H({ metalware: [{ id: 9, level: 1 }, { id: 7, level: 2 }] }), deps)).toBe('#9 1 / 銳利 2');
        expect(containerText(H({ bagName: '分頁' }), deps)).toBe('分頁');
        expect(containerText(H({ bagItemId: 2 }), deps)).toBe('背包');
        expect(containerText(H({ container: 'quest' }), deps)).toBe('任務');
        expect(containerText(H({ container: 'bag', pocket: 99 }), deps)).toBe('未知空間#99');
        expect(containerText(H({ container: 'zzz' }), deps)).toBe('zzz');
    });
    it('distinct sorts and drops empties', () => {
        expect(distinct([H({ master: 'b' }), H({ master: '' }), H({ master: 'a' }), H({ master: 'b' })], h => h.master))
            .toEqual(['a', 'b']);
    });
    it('csv file name is local time stamped', () => {
        expect(csvFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe('物品索引_20260102-030405.csv');
    });
    it('column state keeps valid keys, falls back to defaults', () => {
        expect(DEFAULT_COLS).not.toContain('metalware');
        expect(DEFAULT_COLS).not.toContain('pocket');
        expect(parseVisibleCols('["item","bogus"]')).toEqual(['item']);
        expect(parseVisibleCols('["bogus"]')).toEqual(DEFAULT_COLS);
        expect(parseVisibleCols('not json')).toEqual(DEFAULT_COLS);
        expect(parseVisibleCols(null)).toEqual(DEFAULT_COLS);
        expect(ITEM_COLUMNS).toHaveLength(11);
    });
});

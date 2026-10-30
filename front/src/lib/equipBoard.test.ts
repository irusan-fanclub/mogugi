import { describe, it, expect } from 'vitest';
import { buildBoard, brief, tipText, entryByPocket, MAIN_AREAS, LEFT_POCKETS, RIGHT_POCKETS, WEAPON_POCKETS } from './equipBoard';
import { makeTooltipDeps } from './tooltipDeps';
import type { IndexItem } from './itemIndex';

const deps = makeTooltipDeps({
    itemNameMap: {}, enchantNameMap: { 7: '前綴', 8: '後綴' }, enchantInfoMap: {}, metalwareMap: {},
    manualFormMap: {}, itemUpgradeMap: {}, itemDescMap: {},
});
const item = (id: number, over: Partial<IndexItem> = {}) => ({ id, ...over }) as IndexItem;

describe('equipBoard', () => {
    it('exposes the pocket layout', () => {
        expect(LEFT_POCKETS).toEqual([32, 33, 34, 35, 54]);
        expect(RIGHT_POCKETS).toEqual([51, 62, 63, 64]);
        expect(WEAPON_POCKETS).toEqual({ wl: [10, 11], wr: [13, 12] });
        expect(MAIN_AREAS).toHaveLength(9);
        expect(MAIN_AREAS.slice(0, 3).map(a => a.area)).toEqual(['accl', 'head', 'accr']);
    });
    it('weaponSet.wl=1 resolves the left weapon cell to pocket 11, wr=0 to 13', () => {
        const cells = buildBoard([], { wl: 1, wr: 0 }, deps);
        expect(cells.find(c => c.area === 'wl')!.pocket).toBe(11);
        expect(cells.find(c => c.area === 'wr')!.pocket).toBe(13);
        expect(cells.find(c => c.area === 'wl')!.set).toBe(1);
    });
    it('orders left, main, right and marks empty cells', () => {
        const cells = buildBoard([{ pocket: 8, item: item(1) }], { wl: 0, wr: 0 }, deps);
        expect(cells).toHaveLength(5 + 9 + 4);
        expect(cells.slice(0, 5).every(c => c.region === 'left')).toBe(true);
        expect(cells.slice(14).every(c => c.region === 'right')).toBe(true);
        const head = cells.find(c => c.area === 'head')!;
        expect(head.empty).toBe(false);
        expect(head.entry!.item.id).toBe(1);
        expect(cells.find(c => c.area === 'body')!.empty).toBe(true);
        expect(cells.find(c => c.area === 'body')!.tall).toBe(true);
    });
    it('brief: weapon, armor, accessory enchants', () => {
        expect(brief(item(1, { attackMin: 1, attackMax: 5, balance: 3, critical: 4 }), 10, {})).toBe('攻擊 1~5 平衡 3 暴擊 4');
        expect(brief(item(1, { defense: 9, protection: 2 }), 8, {})).toBe('防禦 9 保護 2');
        expect(brief(item(1, { enchantPrefix: 7, enchantSuffix: 8 }), 16, { 7: '前綴', 8: '後綴' })).toBe('前綴 / 後綴');
        expect(brief(item(1, { enchantPrefix: 99 }), 17, {})).toBe('99');
    });
    it('entryByPocket keeps the entry per pocket', () => {
        const m = entryByPocket([{ pocket: 5, item: item(3, { defense: 1, protection: 1 }) }], deps);
        expect(m.get(5)!.brief).toBe('防禦 1 保護 1');
    });
    it('tipText lists title and tooltip lines', () => {
        const tip = {
            props: ['防禦力 5'], imprint: '等級 3%', enchants: [{ slot: '接頭', name: '甲', rank: 'A', desc: '說明' }], bless: [],
            relic: [], relicDesc: null, magicCircle: [], upgrades: ['改造 1/2'], special: null, energy: null,
            metalware: [{ name: '細工', level: 1, max: 3, value: '+5' }], colorGroups: [],
        };
        expect(tipText('名', tip)).toBe(['名', '等級 3%', '防禦力 5', '接頭 甲 A', '說明', '改造 1/2', '細工 1/3 +5'].join('\n'));
        expect(tipText('名', null)).toBe('名');
    });
});

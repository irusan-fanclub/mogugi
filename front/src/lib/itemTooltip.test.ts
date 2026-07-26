// itemTooltip.test.ts — buildTip 純函式的單元測試（vitest）。
import { describe, it, expect } from 'vitest';
import { buildTip, type TooltipDeps } from './itemTooltip';
import type { Holder } from './itemIndex';

// --- 測試用 stub ---

// 最小 Holder 工廠：只填必要欄位，其餘由 partial 覆蓋。
function holder(partial: Partial<Holder>): Holder {
    return {
        id: 1000,
        entity: 'TestChar',
        master: 'TestOwner',
        qty: 1,
        storage: 'inventory',
        container: 'inv',
        x: 0,
        y: 0,
        ...partial,
    };
}

// 可設定的 stub deps；預設所有 map 為空、itemName 回傳「物品#id」。
function makeDeps(overrides: Partial<TooltipDeps> = {}): TooltipDeps {
    return {
        enchantNameMap: {},
        enchantInfoMap: {},
        metalwareMap: {},
        manualFormMap: {},
        itemUpgradeMap: {},
        itemDescMap: {},
        itemName: (id: number) => `物品#${id}`,
        ...overrides,
    };
}

describe('buildTip', () => {
    it('(a) 附加賦予的裝備：接頭/接尾效果值內嵌成「N (min~max)」範圍文字', () => {
        const h = holder({
            enchantPrefix: 100,
            enchantSuffix: 200,
            prefixEffects: [{ code: 16, value: 53 }],
            suffixEffects: [{ code: 20, value: 4 }],
        });
        const deps = makeDeps({
            enchantInfoMap: {
                100: { name: '辛勤的', level: 5, desc: '最大傷害 增加(50~55)' },
                200: { name: '杜克獵人手套', level: 3, desc: '保護 增加(3~5)' },
            },
        });
        const tip = buildTip(h, deps);
        expect(tip).not.toBeNull();
        // 53 落在 50~55 → 內嵌為「53 (50~55)」
        expect(tip!.enchants[0].desc).toContain('53 (50~55)');
        // 4 落在 3~5 → 內嵌為「4 (3~5)」
        expect(tip!.enchants[1].desc).toContain('4 (3~5)');
        // 等級字母：level 5 → 'B'
        expect(tip!.enchants[0].rank).toBe('B');
    });

    it('(b) 細工物品：算出 (init + (level-1)*per) * standard 並附 subDesc', () => {
        const h = holder({ metalware: [{ id: 7, level: 3 }] });
        const deps = makeDeps({
            metalwareMap: {
                7: {
                    name: '銳利', init: 10, per: 5, max: 20,
                    standard: 1, isFloat: false, subDesc: '% 增加',
                },
            },
        });
        const tip = buildTip(h, deps);
        expect(tip).not.toBeNull();
        expect(tip!.metalware[0].name).toBe('銳利');
        expect(tip!.metalware[0].level).toBe(3);
        // (10 + (3-1)*5) * 1 = 20 → 「20 % 增加」
        expect(tip!.metalware[0].value).toBe('20 % 增加');
    });

    it('(c) 遺物：kind-11 RelicEffects 行 + relicDesc（pocket 在 32-35）', () => {
        const h = holder({
            id: 5000,
            pocket: 32,
            relicEffects: [{ code: 2558, value: 30 }],
        });
        const deps = makeDeps({
            itemDescMap: { 5000: '固定效果說明\\n第二行' },
        });
        const tip = buildTip(h, deps);
        expect(tip).not.toBeNull();
        expect(tip!.relic[0]).toBe('死亡準星傷害 增加30%');
        // 字面 \n 轉真換行
        expect(tip!.relicDesc).toBe('固定效果說明\n第二行');
    });

    it('(d) 衣服樣本/設計圖：FORMID → 剩餘使用次數', () => {
        const h = holder({
            durability: 5000,
            durabilityMax: 10000,
            metadata: 'FORMID:4:123',
        });
        const deps = makeDeps({ manualFormMap: { 123: { name: '衣服樣本 - X', productItemId: null, level: null } } });
        const tip = buildTip(h, deps);
        expect(tip).not.toBeNull();
        // FORMID 存在 → 顯示剩餘使用次數（5000/1000 = 5），非耐久度
        expect(tip!.props).toContain('剩餘使用次數 5');
    });

    it('(e) 純物品（無任何屬性）：回傳 null', () => {
        const tip = buildTip(holder({}), makeDeps());
        expect(tip).toBeNull();
    });

    it('(f) 僅染色的物品：回傳非 null 且含 colorGroups（修掉的 bug）', () => {
        const h = holder({ colors: ['ff0000', '00ff00', '0000ff'] });
        const tip = buildTip(h, makeDeps());
        // 僅有顏色也應掛 tooltip（先前 guard 漏了 colorGroups → 顏色消失）
        expect(tip).not.toBeNull();
        expect(tip!.colorGroups[0].label).toBe('道具顏色');
        expect(tip!.colorGroups[0].colors).toEqual(['ff0000', '00ff00', '0000ff']);
    });
});

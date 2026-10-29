import {
    db, raceNameMap, skillNameMap, condNameMap, itemNameMap,
    enchantNameMap, enchantInfoMap, metalwareMap, manualFormMap, itemUpgradeMap,
} from '@/store';

/** Opens the game db and fills the shared name maps. Does not connect the socket. */
export async function loadNameMaps(): Promise<void> {
    await db.value.tryOpen();
    {
        const list = await db.value.getSortedListData('RaceList');
        for (const v of list) {
            raceNameMap.value[v.Id] = `${db.value.getCurLangString(v.Name)} ${v.Id}`;
        }
        // Manual overrides for entries the DB doesn't yet carry.
        // Remove once the DB ships an updated RaceList.
        raceNameMap.value[7615] = '雷楠的米勒：悔恨 7615';
    }
    {
        const list = await db.value.getSortedListData('SkillList');
        for (const v of list) {
            skillNameMap.value[v.Id] = db.value.getCurLangString(v.Name);
        }
    }
    {
        const list = await db.value.getSortedListData('CharCondList');
        for (const v of list) {
            condNameMap.value[v.Id] = `${db.value.getCurLangString(v.Name)} ${v.Id}`;
        }
    }
    {
        const list = await db.value.getSortedListData('ItemList');
        for (const v of list) {
            itemNameMap.value[v.Id] = `${db.value.getCurLangString(v.Name)} ${v.Id}`;
        }
    }
    try {
        // Plain names (no id suffix); tables may be absent in older dbs.
        const list = await db.value.getOptionSets();
        for (const v of list) {
            enchantNameMap.value[v.Id] = v.Name;
            enchantInfoMap.value[v.Id] = { name: v.Name, level: v.Level, desc: v.Description };
        }
    } catch (e) {
        console.warn('optionset list unavailable (old bundled db?)', e);
    }
    try {
        // 細緻工匠能力表（tooltip 用）。
        const list = await db.value.getMetalwareAbilities();
        for (const v of list) {
            metalwareMap.value[v.Id] = {
                name: v.Name, init: v.InitialValue ?? 0,
                per: v.ValuePerLevel ?? 0, max: v.BaseMaxLevel ?? 0,
                standard: v.Standard ?? 1, isFloat: v.IsFloat === 1,
                subDesc: v.SubDesc ?? '增加',
            };
        }
    } catch (e) {
        console.warn('metalware ability list unavailable (old bundled db?)', e);
    }
    try {
        // 衣服樣本/設計圖名稱表（FORMID → 完整名）。
        const list = await db.value.getManualForms();
        for (const v of list) {
            manualFormMap.value[v.Id] = {
                name: v.Name, productItemId: v.ProductItemId, level: v.Level,
            };
        }
    } catch (e) {
        console.warn('manual form list unavailable (old bundled db?)', e);
    }
    try {
        // 改造名稱表（UPR upgrade_id → 名稱）。
        const list = await db.value.getItemUpgrades();
        for (const v of list) {
            itemUpgradeMap.value[v.Id] = { name: v.Name, desc: v.Description };
        }
    } catch (e) {
        console.warn('item upgrade list unavailable (old bundled db?)', e);
    }
}

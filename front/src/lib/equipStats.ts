// equipStats.ts — equipment-analysis tab: worn-slot table and per-item stat contributions
// (pure functions; the tab compares the sums against the server panel).
import type { IndexItem } from './itemIndex';
import { parseItemMetadata } from './itemIndex';
import type { ownerPanel } from '@/protocols';
import type { Tip } from './itemTooltip';

export type StatKey =
    | 'strMod' | 'dexMod' | 'intMod' | 'willMod' | 'luckMod'
    | 'lifeMax' | 'manaMax' | 'staminaMax'
    | 'attackMin' | 'attackMax' | 'critical' | 'balance'
    | 'defense' | 'protection' | 'magicAttack' | 'magicDefense' | 'magicProtection';

export const STAT_LABELS: Record<StatKey, string> = {
    strMod: '力量', dexMod: '敏捷', intMod: '智力', willMod: '意志', luckMod: '幸運',
    lifeMax: '最大生命力', manaMax: '最大魔力', staminaMax: '最大體力',
    attackMin: '最小攻擊力', attackMax: '最大攻擊力', critical: '暴擊率', balance: '平衡性',
    defense: '防禦力', protection: '保護', magicAttack: '魔法攻擊力',
    magicDefense: '魔法防禦力', magicProtection: '魔法保護',
};

export const STAT_ORDER: StatKey[] = [
    'strMod', 'dexMod', 'intMod', 'willMod', 'luckMod',
    'lifeMax', 'manaMax', 'staminaMax',
    'attackMin', 'attackMax', 'critical', 'balance',
    'defense', 'protection', 'magicAttack', 'magicDefense', 'magicProtection',
];

export interface EquipSlot {
    pocket: number;
    label: string;
    group: 'armor' | 'weapon' | 'other';
    // Only the active weapon set feeds attack/critical/balance.
    countsAttack: boolean;
}

// Display order: armour row, weapon row, then relics/威光/echo stones
// (pocket ids from iruneko knowledge/itemformat/pocket-id.csv).
export const EQUIP_SLOTS: EquipSlot[] = [
    { pocket: 8, label: '頭部', group: 'armor', countsAttack: false },
    { pocket: 5, label: '衣服', group: 'armor', countsAttack: false },
    { pocket: 6, label: '手部', group: 'armor', countsAttack: false },
    { pocket: 7, label: '腳部', group: 'armor', countsAttack: false },
    { pocket: 9, label: '長袍', group: 'armor', countsAttack: false },
    { pocket: 16, label: '左邊飾品', group: 'armor', countsAttack: false },
    { pocket: 17, label: '右邊飾品', group: 'armor', countsAttack: false },
    { pocket: 10, label: '主手', group: 'weapon', countsAttack: true },
    { pocket: 13, label: '副手', group: 'weapon', countsAttack: true },
    { pocket: 11, label: '背後主手', group: 'weapon', countsAttack: false },
    { pocket: 14, label: '背後副手', group: 'weapon', countsAttack: false },
    { pocket: 32, label: '遺物 1', group: 'other', countsAttack: false },
    { pocket: 33, label: '遺物 2', group: 'other', countsAttack: false },
    { pocket: 34, label: '遺物 3', group: 'other', countsAttack: false },
    { pocket: 35, label: '遺物 4', group: 'other', countsAttack: false },
    { pocket: 51, label: '威光', group: 'other', countsAttack: false },
    { pocket: 54, label: '星塵', group: 'other', countsAttack: false },
    { pocket: 62, label: '回音石 1', group: 'other', countsAttack: false },
    { pocket: 63, label: '回音石 2', group: 'other', countsAttack: false },
    { pocket: 64, label: '回音石 3', group: 'other', countsAttack: false },
];

// Effect-line param codes verified against OptionList SetParamOnEquip.
const PARAM_TO_STAT: Record<number, StatKey> = {
    1: 'lifeMax', 3: 'manaMax', 16: 'attackMax', 19: 'critical', 20: 'protection',
    22: 'balance', 53: 'magicAttack', 54: 'magicProtection',
};

export interface Contribution {
    stats: Partial<Record<StatKey, number>>;
    // Effect lines whose param code has no stat mapping yet.
    unmapped: { code: number; value: number }[];
    // Sources seen but deliberately not folded into stats this version.
    skipped: { conditional: number; metalware: number; relic: number };
}

export function contributionsOf(item: IndexItem, pocket: number): Contribution {
    const stats: Partial<Record<StatKey, number>> = {};
    const add = (key: StatKey, v: number | undefined) => {
        if (!v) return;
        stats[key] = (stats[key] ?? 0) + v;
    };
    const c: Contribution = { stats, unmapped: [], skipped: { conditional: 0, metalware: 0, relic: 0 } };

    const slot = EQUIP_SLOTS.find(s => s.pocket === pocket);
    // Back-set weapons (countsAttack false) sit unused, so their defense/
    // protection must not contribute either; armour/other slots always do.
    if (slot?.group !== 'weapon' || slot.countsAttack) {
        add('defense', item.defense);
        add('protection', item.protection);
    }
    if (slot?.countsAttack) {
        add('attackMin', item.attackMin);
        add('attackMax', item.attackMax);
        add('critical', item.critical);
        add('balance', item.balance);
    }

    const meta = parseItemMetadata(item.metadata);
    add('magicDefense', Number(meta.MDEF) || 0);
    add('magicProtection', Number(meta.MPROT) || 0);

    for (const e of [...(item.prefixEffects ?? []), ...(item.suffixEffects ?? []), ...(item.blessEffects ?? [])]) {
        if (e.condSkill) {
            c.skipped.conditional++;
            continue;
        }
        const key = PARAM_TO_STAT[e.code];
        if (key) add(key, e.value);
        else c.unmapped.push({ code: e.code, value: e.value });
    }

    c.skipped.metalware = item.metalware?.length ?? 0;
    c.skipped.relic = item.relicEffects?.length ?? 0;
    return c;
}

export function sumContributions(list: Contribution[]): Partial<Record<StatKey, number>> {
    const out: Partial<Record<StatKey, number>> = {};
    for (const c of list) {
        for (const [k, v] of Object.entries(c.stats) as [StatKey, number][]) {
            out[k] = (out[k] ?? 0) + v;
        }
    }
    return out;
}

// Panel field per stat key. Weapon numbers have no separate mod on the
// wire, so those compare against the total (isTotal).
const PANEL_FIELD: Record<StatKey, { field: keyof ownerPanel; isTotal: boolean }> = {
    strMod: { field: 'strMod', isTotal: false },
    dexMod: { field: 'dexMod', isTotal: false },
    intMod: { field: 'intMod', isTotal: false },
    willMod: { field: 'willMod', isTotal: false },
    luckMod: { field: 'luckMod', isTotal: false },
    lifeMax: { field: 'lifeMaxMod', isTotal: false },
    manaMax: { field: 'manaMaxMod', isTotal: false },
    staminaMax: { field: 'staminaMaxMod', isTotal: false },
    attackMin: { field: 'attackMin', isTotal: true },
    attackMax: { field: 'attackMax', isTotal: true },
    critical: { field: 'critical', isTotal: true },
    balance: { field: 'balance', isTotal: true },
    defense: { field: 'defenseMod', isTotal: false },
    protection: { field: 'protectionMod', isTotal: false },
    magicAttack: { field: 'magicAttackMod', isTotal: false },
    magicDefense: { field: 'magicDefenseMod', isTotal: false },
    magicProtection: { field: 'magicProtectionMod', isTotal: false },
};

export function panelValue(panel: ownerPanel, key: StatKey): { value: number; isTotal: boolean } {
    const m = PANEL_FIELD[key];
    return { value: Number(panel[m.field]), isTotal: m.isTotal };
}

// SlotEntry is what one worn-gear cell renders; WeaponSet is the in-game
// I/II weapon-set toggle (I = pocket 10/13, II = 11/14).
export type WeaponSet = 'I' | 'II';
export interface SlotEntry { item: IndexItem; name: string; brief: string; tip: Tip | null }

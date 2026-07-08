export interface IndexMetalware { id: number; level: number }
export interface IndexEnchantRoll { code: number; value: number; condSkill?: number; condRank?: number }
export interface IndexItem {
    id: number; qty: number; container: string; x: number; y: number;
    enchantPrefix?: number; enchantSuffix?: number;
    durability?: number; durabilityMax?: number; defense?: number;
    attackMin?: number; attackMax?: number;
    metalware?: IndexMetalware[];
    enchantRolls?: IndexEnchantRoll[];
}
export interface IndexEntity { entity: string; master: string; items: IndexItem[] }
export interface Holder {
    id: number; entity: string; master: string; qty: number; container: string; x: number; y: number;
    enchantPrefix?: number; enchantSuffix?: number;
    durability?: number; durabilityMax?: number; defense?: number;
    attackMin?: number; attackMax?: number;
    metalware?: IndexMetalware[];
    enchantRolls?: IndexEnchantRoll[];
}

// buildItemIndex 把 /api/item-index 的聚合資料轉成 item id → 持有者清單。
export function buildItemIndex(data: IndexEntity[]): Map<number, Holder[]> {
    const idx = new Map<number, Holder[]>();
    for (const ent of data) {
        for (const it of ent.items) {
            const arr = idx.get(it.id) ?? [];
            arr.push({
                id: it.id, entity: ent.entity, master: ent.master,
                qty: it.qty, container: it.container, x: it.x, y: it.y,
                enchantPrefix: it.enchantPrefix, enchantSuffix: it.enchantSuffix,
                durability: it.durability, durabilityMax: it.durabilityMax,
                defense: it.defense, attackMin: it.attackMin, attackMax: it.attackMax,
                metalware: it.metalware,
                enchantRolls: it.enchantRolls,
            });
            idx.set(it.id, arr);
        }
    }
    return idx;
}

export function searchById(idx: Map<number, Holder[]>, id: number): Holder[] {
    return idx.get(id) ?? [];
}

// searchByName 用 nameToId 反查（可回傳多個 id），合併各 id 的持有者。
export function searchByName(
    idx: Map<number, Holder[]>,
    name: string,
    nameToIds: (name: string) => number[],
): Holder[] {
    const out: Holder[] = [];
    for (const id of nameToIds(name)) {
        out.push(...searchById(idx, id));
    }
    return out;
}

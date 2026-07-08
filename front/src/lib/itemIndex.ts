export interface IndexMetalware { id: number; level: number }
export interface IndexEnchantEffect { code: number; value: number; condSkill?: number; condRank?: number }
interface ItemExtra {
    enchantPrefix?: number; enchantSuffix?: number;
    durability?: number; durabilityMax?: number; defense?: number; protection?: number;
    attackMin?: number; attackMax?: number;
    injuryMin?: number; injuryMax?: number; balance?: number; critical?: number;
    metalware?: IndexMetalware[];
    prefixEffects?: IndexEnchantEffect[];
    suffixEffects?: IndexEnchantEffect[];
    blessEffects?: IndexEnchantEffect[];
    relicEffects?: IndexEnchantEffect[];
    bagItemId?: number;  // 所在袋子的 item id（0/undefined = 非袋內）
    pocket?: number;     // 原始 pocket id
    colors?: string[];   // 六色 rrggbb hex
    metadata?: string;   // MetaData1 原始 KV 字串
}
export interface IndexItem extends ItemExtra {
    id: number; qty: number; container: string; x: number; y: number;
}
export interface IndexEntity { entity: string; master: string; items: IndexItem[] }
export interface Holder extends ItemExtra {
    id: number; entity: string; master: string; qty: number; container: string; x: number; y: number;
}

// parseItemMetadata 解析 MetaData1 KV 字串（"KEY:type:value;…"）成 map。
export function parseItemMetadata(s?: string): Record<string, string> {
    const out: Record<string, string> = {};
    if (!s) return out;
    for (const tok of s.split(';')) {
        if (!tok) continue;
        const parts = tok.split(':');
        if (parts.length < 3) continue;
        out[parts[0]] = parts.slice(2).join(':');
    }
    return out;
}

// buildItemIndex 把 /api/item-index 的聚合資料轉成 item id → 持有者清單。
export function buildItemIndex(data: IndexEntity[]): Map<number, Holder[]> {
    const idx = new Map<number, Holder[]>();
    for (const ent of data) {
        for (const it of ent.items) {
            const arr = idx.get(it.id) ?? [];
            arr.push({
                ...it,
                entity: ent.entity, master: ent.master,
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

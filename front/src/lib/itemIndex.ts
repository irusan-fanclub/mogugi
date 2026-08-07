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
    bagName?: string;    // display name for named containers such as bank tabs
    pocket?: number;     // 原始 pocket id
    colors?: string[];   // 六色 rrggbb hex
    metadata?: string;   // MetaData1 原始 KV 字串
}
export interface IndexItem extends ItemExtra {
    id: number; qty: number; storage: string; container: string; x: number; y: number;
}
export interface IndexEntity { entity: string; master: string; items: IndexItem[] }
export interface Holder extends ItemExtra {
    id: number; entity: string; master: string; qty: number; storage: string; container: string; x: number; y: number;
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

export type SearchQuery =
    | { kind: 'empty' }
    | { kind: 'id'; id: number }
    | { kind: 'text'; needle: string }
    | { kind: 'regex'; re: RegExp }
    | { kind: 'error'; message: string };

// Allowed regex flags. `g` is excluded on purpose: it makes RegExp.test()
// stateful via lastIndex, which would drop rows at random while filtering.
const ALLOWED_FLAGS = 'imsu';

// parseSearchQuery classifies the search box input: `/pattern/flags` is a
// regex (default `i`), a bare number matches an item id, anything else is a
// lowercase substring — the historical behaviour.
//
// `i` is always forced on: the corpus this matches against (searchText /
// searchTextCache) is pre-lowercased, so a user-requested case-sensitive
// match would silently match nothing.
export function parseSearchQuery(raw: string): SearchQuery {
    const q = (raw ?? '').trim();
    if (!q) return { kind: 'empty' };

    const m = /^\/(.+)\/([a-z]*)$/.exec(q);
    if (m) {
        const flags = new Set([...m[2]].filter(f => ALLOWED_FLAGS.includes(f)));
        flags.add('i');
        try {
            return { kind: 'regex', re: new RegExp(m[1], [...flags].join('')) };
        } catch (e) {
            return { kind: 'error', message: `正則式無效：${(e as Error).message}` };
        }
    }
    if (/^\d+$/.test(q)) return { kind: 'id', id: Number(q) };
    return { kind: 'text', needle: q.toLowerCase() };
}

export type ExcludeColumn = 'item' | 'entity' | 'storage';
export interface ExcludeEntry { col: ExcludeColumn; value: string }
export interface ExcludeSets { item: Set<string>; entity: Set<string>; storage: Set<string> }

const EXCLUDE_COLUMNS: ExcludeColumn[] = ['item', 'entity', 'storage'];

// parseExcludeEntries validates a localStorage payload entry by entry, so one
// bad record cannot take the whole tab down.
export function parseExcludeEntries(raw: string | null): ExcludeEntry[] {
    if (!raw) return [];
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed)) return [];

    const out: ExcludeEntry[] = [];
    const seen = new Set<string>();
    for (const e of parsed) {
        if (!e || typeof e !== 'object') continue;
        const { col, value } = e as { col?: unknown; value?: unknown };
        if (typeof value !== 'string' || !value) continue;
        if (!EXCLUDE_COLUMNS.includes(col as ExcludeColumn)) continue;
        const key = `${col as string}:${value}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ col: col as ExcludeColumn, value });
    }
    return out;
}

// buildExcludeSets turns the list into per-column lookups, so filtering stays
// O(1) per row no matter how long the list grows.
export function buildExcludeSets(entries: ExcludeEntry[]): ExcludeSets {
    const sets: ExcludeSets = { item: new Set(), entity: new Set(), storage: new Set() };
    for (const e of entries) sets[e.col].add(e.value);
    return sets;
}

export function isExcludeEmpty(sets: ExcludeSets): boolean {
    return sets.item.size === 0 && sets.entity.size === 0 && sets.storage.size === 0;
}

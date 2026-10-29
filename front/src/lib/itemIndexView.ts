// itemIndexView.ts — pure view logic of the item index (shared by old and desktop tabs).
import {
    parseSearchQuery, buildExcludeSets, isExcludeEmpty,
    type ExcludeEntry, type Holder,
} from './itemIndex';
import {
    buildTip, displayName, effectColumnText, pocketName, type Tip, type TooltipDeps,
} from './itemTooltip';

// A type alias (not interface) so rows fit sortRows' Record<string, unknown>.
export type ItemRow = {
    rid: number; // index in the built list; unique row key
    item: string;
    itemId: number;
    effect: string;
    entity: string;
    master: string;
    storage: string;
    container: string;
    pocket: number | '';
    qty: number;
    pos: string;
    metalware: string;
    tip: Tip | null;
};

export const ITEM_COLUMNS = [
    { title: '物品', key: 'item' },
    { title: '物品ID', key: 'itemId' },
    { title: '效果', key: 'effect' },
    { title: '細工', key: 'metalware' },
    { title: '角色', key: 'entity' },
    { title: 'Owner', key: 'master' },
    { title: '存放處', key: 'storage' },
    { title: '背包', key: 'container' },
    { title: '背包編號', key: 'pocket' },
    { title: '數量', key: 'qty' },
    { title: '座標', key: 'pos' },
];
// Metalware and bag-number columns start hidden.
export const DEFAULT_COLS = ITEM_COLUMNS.map(c => c.key).filter(k => k !== 'metalware' && k !== 'pocket');

// Keeps still-existing keys; nothing valid (or bad JSON) falls back to the defaults.
export function parseVisibleCols(raw: string | null): string[] {
    try {
        if (raw) {
            const saved = JSON.parse(raw) as string[];
            const valid = saved.filter(k => ITEM_COLUMNS.some(c => c.key === k));
            if (valid.length) return valid;
        }
    } catch { /* ignore */ }
    return [...DEFAULT_COLS];
}

// Bag column: bag/tab name > bag item name > known pocket name > category > unknown space#pocket.
export function containerText(h: Holder, deps: TooltipDeps): string {
    if (h.bagName) return h.bagName;
    if (h.bagItemId) return deps.itemName(h.bagItemId);
    const tab = pocketName(h.pocket ?? 0);
    if (tab) return tab;
    if (h.container === 'quest') return '任務';
    if (h.container === 'bag') return `未知空間#${h.pocket ?? '?'}`;
    return h.container;
}

const STORAGE_NAMES: Record<string, string> = { inventory: '物品欄', beauty: '美容室', bank: '銀行' };
export const storageText = (h: Holder): string => STORAGE_NAMES[h.storage] ?? h.storage;

// Metalware summary: "name level" joined by " / ".
export function metalwareText(h: Holder, deps: TooltipDeps): string {
    return (h.metalware ?? [])
        .map(m => `${deps.metalwareMap[m.id]?.name ?? `#${m.id}`} ${m.level}`)
        .join(' / ');
}

// Search haystack: display name + metalware names + effect column, lowercased.
export function searchTextOf(h: Holder, deps: TooltipDeps): string {
    return `${displayName(h, deps)} ${metalwareText(h, deps)} ${effectColumnText(h, deps.enchantInfoMap)}`.toLowerCase();
}

export function buildSearchCache(holders: Holder[], deps: TooltipDeps): Map<Holder, string> {
    const m = new Map<Holder, string>();
    for (const h of holders) m.set(h, searchTextOf(h, deps));
    return m;
}

export function searchError(query: string): string {
    const q = parseSearchQuery(query ?? '');
    return q.kind === 'error' ? q.message : '';
}

export function distinct(holders: Holder[], key: (h: Holder) => string): string[] {
    const set = new Set<string>();
    for (const h of holders) {
        const v = key(h);
        if (v) set.add(v);
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

export interface BuildRowsOptions {
    query: string;
    entity: string[];
    master: string[];
    storage: string[]; // display texts, as shown in the 存放處 column
    excludes: ExcludeEntry[];
    deps: TooltipDeps;
    /** Precomputed buildSearchCache result; saves recomputing on every keystroke. */
    searchCache?: Map<Holder, string>;
}

// Filters (query AND entity AND master AND storage, minus excludes) then maps to display rows.
export function buildRows(holders: Holder[], o: BuildRowsOptions): ItemRow[] {
    const sq = parseSearchQuery(o.query ?? '');
    if (sq.kind === 'error') return [];
    const text = (h: Holder) => o.searchCache?.get(h) ?? searchTextOf(h, o.deps);
    let hs = holders;
    if (sq.kind === 'id') hs = hs.filter(h => h.id === sq.id);
    else if (sq.kind === 'text') hs = hs.filter(h => text(h).includes(sq.needle));
    else if (sq.kind === 'regex') hs = hs.filter(h => sq.re.test(text(h)));
    if (o.entity.length) hs = hs.filter(h => o.entity.includes(h.entity));
    if (o.master.length) hs = hs.filter(h => o.master.includes(h.master));
    if (o.storage.length) hs = hs.filter(h => o.storage.includes(storageText(h)));
    const ex = buildExcludeSets(o.excludes);
    if (!isExcludeEmpty(ex)) {
        hs = hs.filter(h =>
            !ex.entity.has(h.entity)
            && !ex.storage.has(storageText(h))
            // displayName is the expensive one; only pay for it when items are excluded.
            && !(ex.item.size > 0 && ex.item.has(displayName(h, o.deps))));
    }
    return hs.map((h, rid) => ({
        rid,
        item: displayName(h, o.deps),
        itemId: h.id,
        effect: effectColumnText(h, o.deps.enchantInfoMap),
        entity: h.entity,
        master: h.master,
        storage: storageText(h),
        container: containerText(h, o.deps),
        pocket: h.pocket ?? '',
        qty: h.qty,
        pos: `(${h.x},${h.y})`,
        metalware: metalwareText(h, o.deps),
        tip: buildTip(h, o.deps),
    }));
}

// Display-ready cell text (CSV export).
export function cellText(row: ItemRow, key: string): string {
    const v = (row as unknown as Record<string, unknown>)[key];
    return v == null ? '' : String(v);
}

export function csvFileName(now: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
        + `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    return `物品索引_${ts}.csv`;
}


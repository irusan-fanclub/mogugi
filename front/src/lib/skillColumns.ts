// Optional skill-table columns. Header and data both iterate this list, so a
// column cannot appear in one and not the other.
export interface DetailColumn { key: string; label: string; width: number }

export const DETAIL_COLUMNS: DetailColumn[] = [
    { key: 'hitsPerMin', label: '每分鐘命中數', width: 88 },
    { key: 'castCount', label: '施放次數', width: 68 },
    { key: 'critCount', label: '爆擊次數', width: 68 },
    { key: 'normalCount', label: '非爆次數', width: 68 },
    { key: 'critRate', label: '爆擊率', width: 68 },
    { key: 'avg', label: '平均', width: 68 },
    { key: 'critAvg', label: '爆擊平均', width: 68 },
    { key: 'normalAvg', label: '非爆平均', width: 68 },
    { key: 'min', label: '最低', width: 68 },
    { key: 'max', label: '最高', width: 68 },
    { key: 'critMin', label: '爆擊最低', width: 68 },
    { key: 'critMax', label: '爆擊最高', width: 68 },
    { key: 'normalMin', label: '非爆最低', width: 68 },
    { key: 'normalMax', label: '非爆最高', width: 68 },
    { key: 'critSummary', label: '爆擊統計', width: 300 },
    { key: 'normalSummary', label: '非爆統計', width: 300 },
];

/** Saved order merged with the declared one; a new column lands after its declared predecessor. */
export function mergeColumnOrder(saved: string[]): string[] {
    const known = new Set(DETAIL_COLUMNS.map(c => c.key));
    const out = saved.filter(k => known.has(k));
    DETAIL_COLUMNS.forEach((c, i) => {
        if (saved.includes(c.key)) return;
        const prev = i > 0 ? out.findIndex(o => o === DETAIL_COLUMNS[i - 1].key) : -1;
        out.splice(prev + 1, 0, c.key);
    });
    return out;
}

export function visibleColumns(order: string[], hidden: Set<string>): string[] {
    return order.filter(k => !hidden.has(k));
}

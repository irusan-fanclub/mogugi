// csvExport.ts — pure CSV builder + browser download helper.

// Quote a field if it contains a comma, quote, or line break; double inner quotes.
function quoteField(field: string): string {
    if (/[",\r\n]/.test(field)) {
        return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
}

// buildCsv: header + rows -> CRLF-joined CSV text (no trailing line break).
export function buildCsv(header: string[], rowsText: string[][]): string {
    return [header, ...rowsText]
        .map(row => row.map(quoteField).join(','))
        .join('\r\n');
}

export interface SortSpec { key: string; order: 'asc' | 'desc' }

// isEmptyVal mirrors Vuetify's util.isEmpty: null/undefined/blank string.
function isEmptyVal(v: unknown): boolean {
    return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

// sortRows: mirrors VDataTable's default comparator (composables/sort.js
// `sortItems`) for flat string/number fields — case-insensitive collator
// compare, numeric compare when both sides parse as numbers, empty values
// first, multi-key precedence — so CSV export matches the on-screen order.
export function sortRows<T extends Record<string, unknown>>(rows: T[], sortBy: SortSpec[]): T[] {
    if (!sortBy.length) return rows;
    const collator = new Intl.Collator(undefined, { sensitivity: 'accent', usage: 'sort' });
    return [...rows].sort((a, b) => {
        for (const { key, order } of sortBy) {
            let rawA: unknown = a[key];
            let rawB: unknown = b[key];
            if (order === 'desc') [rawA, rawB] = [rawB, rawA];
            const sa = rawA != null ? String(rawA).toLocaleLowerCase() : rawA;
            const sb = rawB != null ? String(rawB).toLocaleLowerCase() : rawB;
            if (sa === sb) continue;
            if (isEmptyVal(sa) && isEmptyVal(sb)) return 0;
            if (isEmptyVal(sa)) return -1;
            if (isEmptyVal(sb)) return 1;
            if (!isNaN(Number(sa)) && !isNaN(Number(sb))) return Number(sa) - Number(sb);
            return collator.compare(sa as string, sb as string);
        }
        return 0;
    });
}

const BOM = String.fromCharCode(0xFEFF);

// downloadCsv: trigger a browser download of csv as a UTF-8 (BOM-prefixed) file.
export function downloadCsv(filename: string, csv: string): void {
    const blob = new Blob([BOM + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

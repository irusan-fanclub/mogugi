// charSlots.ts — equipment pocket names and display order for the characters tab.

export interface CharSlot { pocket: number; name: string }

// Listed in display order; pockets not listed here sort after, by number.
const MAIN: CharSlot[] = [
    { pocket: 3, name: '臉型' }, { pocket: 4, name: '髮型' },
    { pocket: 8, name: '裝備-頭部' }, { pocket: 5, name: '裝備-身體' },
    { pocket: 6, name: '裝備-手部' }, { pocket: 7, name: '裝備-腳部' },
    { pocket: 9, name: '裝備-長袍' },
    { pocket: 16, name: '裝備-左飾品' }, { pocket: 17, name: '裝備-右飾品' },
    { pocket: 10, name: '主手' }, { pocket: 13, name: '副手' },
    { pocket: 11, name: '背後主手' }, { pocket: 12, name: '背後副手' },
    { pocket: 46, name: '時裝-頭部' }, { pocket: 43, name: '時裝-身體' },
    { pocket: 44, name: '時裝-手部' }, { pocket: 45, name: '時裝-腳部' },
    { pocket: 47, name: '時裝-長袍' }, { pocket: 48, name: '時裝-臉部裝飾' },
    { pocket: 90, name: '時裝-尾巴' },
    { pocket: 91, name: '時裝-左飾品' }, { pocket: 92, name: '時裝-右飾品' },
];

// Named but not part of the fixed order (iruneko pocket-id.csv).
const EXTRA: CharSlot[] = [
    { pocket: 32, name: '遺物1' }, { pocket: 33, name: '遺物2' },
    { pocket: 34, name: '遺物3' }, { pocket: 35, name: '遺物4' },
    { pocket: 51, name: '威光' }, { pocket: 54, name: '星塵' },
    { pocket: 62, name: '回音石1' }, { pocket: 63, name: '回音石2' }, { pocket: 64, name: '回音石3' },
];

export const CHAR_SLOTS: readonly CharSlot[] = [...MAIN, ...EXTRA];

const NAMES = new Map(CHAR_SLOTS.map(s => [s.pocket, s.name]));
const RANK = new Map(MAIN.map((s, i) => [s.pocket, i]));

export const slotName = (pocket: number): string => NAMES.get(pocket) ?? `欄位 ${pocket}`;

/** Fixed-order pockets first, then every other pocket by number. */
export function sortByCharSlot<T extends { PocketType: number }>(items: T[]): T[] {
    const rank = (p: number) => RANK.get(p) ?? MAIN.length;
    return [...items].sort((a, b) => rank(a.PocketType) - rank(b.PocketType) || a.PocketType - b.PocketType);
}

/** "#aarrggbb" or "#rrggbb" -> "#rrggbb" (alpha/flag byte dropped, lowercase). */
export function colorCode(raw: string): string {
    return '#' + raw.replace(/^#/, '').padStart(6, '0').slice(-6).toLowerCase();
}

/** Colour slots shown per item, in display order. */
export const COLOR_KEYS = ['Color1', 'Color2', 'Color3', 'Color5', 'Color6', 'Color7'] as const;

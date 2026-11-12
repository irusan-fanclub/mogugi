import type { GapMode } from './overlaySections';
import type { TileVM } from './overlayTiles';

export interface GridRow { holderId: string; name: string; cells: (TileVM | null)[] }

/** One row per holder, one column per same-class item group; absent cells are null. */
export function buildMemberGrid(
    tiles: TileVM[], keys: readonly string[], classOf: (key: string) => string, gap: GapMode,
): GridRow[] {
    const classes: string[] = [];
    for (const k of keys) { const c = classOf(k); if (!classes.includes(c)) classes.push(c); }
    const holders = new Map<string, TileVM[]>();
    for (const t of tiles) holders.set(t.holderId, [...(holders.get(t.holderId) ?? []), t]);
    const rows: GridRow[] = [...holders].map(([holderId, own]) => ({
        holderId, name: own[0].holderName,
        cells: classes.map(c => own.filter(t => keys.includes(t.key) && classOf(t.key) === c)
            .sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key))[0] ?? null),
    }));
    const used = classes.map((_, i) => rows.some(r => r.cells[i]));
    for (const r of rows) {
        r.cells = r.cells.filter((_, i) => used[i]);
        if (gap === 'pack') r.cells = [...r.cells.filter(Boolean), ...r.cells.filter(c => !c)];
    }
    return rows;
}

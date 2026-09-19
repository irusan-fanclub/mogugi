// battleFilter.ts — pure helpers for the 戰鬥紀錄 tab: filtering, byte
// formatting, and deriving filter dropdown options from the fetched list.

export type BattlePlayer = {
    EntityId: string; Name: string; Arcana: number; Damage: number; Dps: number;
}

export type BattleFight = {
    stage: string; bossRace: number; bossName: string; bossMaxLife?: number;
    fightStartAt: number; fightEndAt: number; durationSec: number;
    cleared?: boolean; partySize: number;
    ownerDps?: number; ownerArcana?: number;
    // Owner's highest music-buff (CC 680 戰場的序曲 / 192 活潑板) pct in the
    // fight window; both absent when no music buff was active.
    musicCcId?: number; musicPct?: number;
    players: BattlePlayer[];
}

export type BattleRecord = {
    file: string; code: string; tier: string;
    player: string; startedAtLocal: string; sizeBytes: number;
    note?: string;
    // One fight per stage; absent while still recording.
    fights?: BattleFight[];
}

// BattleRow is what the table renders: one row per boss fight, or one bare
// row for a file with no fights yet.
export type BattleRow = {
    key: string; file: string; code: string; tier: string; player: string;
    startedAtLocal: string; sizeBytes: number; note?: string;
    sortTime: number; // fight start (unix s), or the file's start time
    bossName?: string; bossRace?: number; durationSec?: number;
    cleared?: boolean; partySize?: number; ownerDps?: number; ownerArcana?: number;
    musicCcId?: number; musicPct?: number;
    fightStartAt?: number;
    players?: BattlePlayer[];
}

// flattenBattles expands records into fight rows, keeping records order
// (per-file: fights in stage order).
export function flattenBattles(records: BattleRecord[]): BattleRow[] {
    const rows: BattleRow[] = [];
    for (const r of records) {
        const base = {
            file: r.file, code: r.code, tier: r.tier, player: r.player,
            startedAtLocal: r.startedAtLocal, sizeBytes: r.sizeBytes, note: r.note,
        };
        if (r.fights?.length) {
            for (const f of r.fights) {
                rows.push({
                    ...base,
                    key: `${r.file}#${f.stage}`,
                    sortTime: f.fightStartAt,
                    bossName: f.bossName, bossRace: f.bossRace,
                    durationSec: f.durationSec, cleared: f.cleared,
                    partySize: f.partySize, ownerDps: f.ownerDps,
                    ownerArcana: f.ownerArcana, fightStartAt: f.fightStartAt,
                    musicCcId: f.musicCcId, musicPct: f.musicPct,
                    players: f.players,
                });
            }
        } else {
            rows.push({ ...base, key: r.file, sortTime: Date.parse(r.startedAtLocal) / 1000 || 0 });
        }
    }
    return rows;
}

// orderPartyArcana: recording player first (matched by name, as the backend
// does — battleIndex.go picks the owner by name), rest by damage desc.
export function orderPartyArcana(players: BattlePlayer[], ownerName: string): BattlePlayer[] {
    const ownerIdx = players.findIndex(p => p.Name === ownerName);
    if (ownerIdx === -1) return [...players].sort((a, b) => b.Damage - a.Damage);
    const rest = players.filter((_, i) => i !== ownerIdx).sort((a, b) => b.Damage - a.Damage);
    return [players[ownerIdx], ...rest];
}

// splitOwnerArcana: same owner-first order as orderPartyArcana, but split so
// the UI can render a separator between the owner's icon and teammates'.
// No owner when the owner has no arcana (filtered out) or isn't in the party.
export function splitOwnerArcana(players: BattlePlayer[], ownerName: string):
    { owner?: BattlePlayer; teammates: BattlePlayer[] } {
    const ordered = orderPartyArcana(players, ownerName).filter(p => p.Arcana);
    if (ordered.length && ordered[0].Name === ownerName) {
        return { owner: ordered[0], teammates: ordered.slice(1) };
    }
    return { teammates: ordered };
}

export type BattleSortKey = 'startedAt' | 'dps' | 'duration';

// sortBattles: stable sort of fight rows with rows lacking the key always
// last, whichever direction is chosen.
export function sortBattles(rows: BattleRow[], key: BattleSortKey, dir: 'asc' | 'desc'): BattleRow[] {
    const val = (r: BattleRow): number | undefined => {
        if (key === 'dps') return r.ownerDps;
        if (key === 'duration') return r.durationSec;
        return r.sortTime;
    };
    const sign = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
        const av = val(a), bv = val(b);
        if (av === undefined && bv === undefined) return 0;
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        return (av - bv) * sign;
    });
}

export type PersonalStat = { best: number; bestFile: string; avg: number; count: number };

// personalStats: per player+boss history over the currently known records —
// backs the "personal best" badge and the DPS tooltip. Only cleared fights
// count, so 木頭人 stages and pre-backfill files (cleared undefined) drop out.
export function personalStats(rows: BattleRow[]): Map<string, PersonalStat> {
    const m = new Map<string, PersonalStat>();
    const sums = new Map<string, number>();
    for (const r of rows) {
        if (!r.ownerDps || !r.bossRace || r.cleared !== true) continue;
        const key = `${r.player}|${r.bossRace}`;
        const cur = m.get(key);
        if (!cur) {
            m.set(key, { best: r.ownerDps, bestFile: r.key, avg: 0, count: 1 });
            sums.set(key, r.ownerDps);
        } else {
            cur.count++;
            sums.set(key, (sums.get(key) ?? 0) + r.ownerDps);
            if (r.ownerDps > cur.best) {
                cur.best = r.ownerDps;
                cur.bestFile = r.key;
            }
        }
    }
    for (const [key, stat] of m) {
        stat.avg = (sums.get(key) ?? 0) / stat.count;
    }
    return m;
};
export type BattleFilter = {
    code?: string; player?: string; from?: string; to?: string;
};

// from/to are RFC3339-with-offset strings, same as startedAtLocal, so plain
// string comparison matches chronological order (within one zone).
export function filterBattles(list: BattleRecord[], f: BattleFilter): BattleRecord[] {
    return list.filter(v =>
        (f.code === undefined || v.code === f.code) &&
        (f.player === undefined || v.player === f.player) &&
        (f.from === undefined || v.startedAtLocal >= f.from) &&
        (f.to === undefined || v.startedAtLocal <= f.to));
}

// filterByBossName: runs after flattenBattles since bossName is a per-fight
// (row) property, not a per-file (record) one.
export function filterByBossName(rows: BattleRow[], bossName?: string): BattleRow[] {
    if (bossName === undefined) return rows;
    return rows.filter(r => r.bossName === bossName);
}

export type ClearedFilterValue = 'cleared' | 'notCleared' | 'unknown';

// filterByCleared: mirrors the table's tri-state ✓ / ✗ / - on
// cleared true / false / undefined.
export function filterByCleared(rows: BattleRow[], cleared?: ClearedFilterValue): BattleRow[] {
    if (cleared === undefined) return rows;
    if (cleared === 'cleared') return rows.filter(r => r.cleared === true);
    if (cleared === 'notCleared') return rows.filter(r => r.cleared === false);
    return rows.filter(r => r.cleared === undefined);
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB'];

// humanReadableBytes: sizeBytes -> display string for the file-size column.
// Plain bytes below 1KB, two decimals once a larger unit kicks in.
export function humanReadableBytes(n: number): string {
    if (!Number.isFinite(n) || n <= 0) return '0 B';

    let value = n;
    let i = 0;
    while (value >= 1024 && i < BYTE_UNITS.length - 1) {
        value /= 1024;
        i++;
    }

    return i === 0 ? `${value} ${BYTE_UNITS[i]}` : `${value.toFixed(2)} ${BYTE_UNITS[i]}`;
}

// distinctOptions: sorted, deduplicated values for a v-select's :items,
// derived from the list itself so options never go stale against filters.
// Generic so it also works over flattened BattleRow[] (e.g. bossName).
export function distinctOptions<T>(list: T[], pick: (v: T) => string): string[] {
    return [...new Set(list.map(pick))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

// Display names for dungeon codes; the raw code is still used for filtering
// so this is a presentation-only lookup.
export const DUNGEON_NAMES: Record<string, string> = {
    brileith: '布里萊赫',
    brileith_practice: '布里萊赫練習模式',
    crombas_abyss: '喀輪巴斯深淵',
    training: '實戰課程-木頭人',
};

// dungeonDisplayName: falls back to the raw code for anything not yet in
// DUNGEON_NAMES, so an unmapped dungeon still shows something useful.
export function dungeonDisplayName(code: string): string {
    return DUNGEON_NAMES[code] ?? code;
}

// formatStartedAt: startedAtLocal is already local wall-clock text
// (RFC3339); slicing avoids a Date round-trip that could misparse or
// re-shift the offset.
export function formatStartedAt(v: string): string {
    return v.slice(0, 19).replace('T', ' ');
}

/**
 * datetime-local input value -> RFC3339 string with the local UTC offset,
 * for comparing against BattleRecord.startedAtLocal. Lives here because a
 * sign slip in the offset silently shifts every comparison by double the
 * zone's distance from UTC, which no type check would catch.
 */
export function toLocalRFC3339(v: string | null): string | undefined {
    if (!v) return undefined;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return undefined;

    const pad = (n: number) => String(n).padStart(2, '0');
    // getTimezoneOffset() is UTC-minus-local in minutes (UTC+8 reports
    // -480), the opposite sign convention from an RFC3339 offset.
    const offsetMin = -d.getTimezoneOffset();
    const sign = offsetMin >= 0 ? '+' : '-';
    const absMin = Math.abs(offsetMin);

    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
        `${sign}${pad(Math.floor(absMin / 60))}:${pad(absMin % 60)}`;
}

// Battle-records table column keys, in their default display order.
export type BattleColKey =
    | 'startedAt' | 'bossName' | 'duration' | 'cleared' | 'player'
    | 'dps' | 'partySize' | 'arcana' | 'music';

export const DEFAULT_BATTLE_COLS: BattleColKey[] = [
    'startedAt', 'bossName', 'duration', 'cleared', 'player',
    'dps', 'partySize', 'arcana', 'music',
];

export type BattleColState = { key: BattleColKey; visible: boolean };

// mergeBattleCols: reconciles a persisted column order/visibility list
// against the current default keys — drops columns no longer defined,
// appends new ones (visible) at the end, otherwise keeps stored order.
export function mergeBattleCols(
    stored: BattleColState[] | null | undefined,
    defaults: BattleColKey[] = DEFAULT_BATTLE_COLS,
): BattleColState[] {
    if (!stored || !stored.length) return defaults.map(key => ({ key, visible: true }));
    const known = new Set<string>(defaults);
    const kept = stored.filter(c => known.has(c.key));
    const present = new Set(kept.map(c => c.key));
    const added = defaults.filter(k => !present.has(k)).map(key => ({ key, visible: true }));
    return [...kept, ...added];
}

// moveBattleCol: pure array-move for drag-to-reorder; out-of-range `from`
// or a no-op from===to still returns a fresh copy, never the same reference.
export function moveBattleCol(cols: BattleColState[], from: number, to: number): BattleColState[] {
    if (from < 0 || from >= cols.length || from === to) return [...cols];
    const next = [...cols];
    const [item] = next.splice(from, 1);
    const clampedTo = Math.max(0, Math.min(to, next.length));
    next.splice(clampedTo, 0, item);
    return next;
}

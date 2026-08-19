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
                    players: f.players,
                });
            }
        } else {
            rows.push({ ...base, key: r.file, sortTime: Date.parse(r.startedAtLocal) / 1000 || 0 });
        }
    }
    return rows;
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
// backs the "personal best" badge and the DPS tooltip.
export function personalStats(rows: BattleRow[]): Map<string, PersonalStat> {
    const m = new Map<string, PersonalStat>();
    const sums = new Map<string, number>();
    for (const r of rows) {
        if (!r.ownerDps || !r.bossRace) continue;
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
    code?: string; tier?: string; player?: string; from?: string; to?: string;
};

// from/to are RFC3339-with-offset strings, same as startedAtLocal, so plain
// string comparison matches chronological order (within one zone).
export function filterBattles(list: BattleRecord[], f: BattleFilter): BattleRecord[] {
    return list.filter(v =>
        (f.code === undefined || v.code === f.code) &&
        (f.tier === undefined || v.tier === f.tier) &&
        (f.player === undefined || v.player === f.player) &&
        (f.from === undefined || v.startedAtLocal >= f.from) &&
        (f.to === undefined || v.startedAtLocal <= f.to));
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
export function distinctOptions(list: BattleRecord[], pick: (v: BattleRecord) => string): string[] {
    return [...new Set(list.map(pick))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

// Display names for dungeon codes; the raw code is still used for filtering
// so this is a presentation-only lookup.
export const DUNGEON_NAMES: Record<string, string> = {
    brileith: '布里萊赫',
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

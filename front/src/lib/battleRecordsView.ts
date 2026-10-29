// battleRecordsView.ts — pure view logic of the battle-records tab.
import {
    filterBattles, filterByBossName, filterByCleared, flattenBattles, sortBattles, toLocalRFC3339,
    type BattleColKey, type BattlePlayer, type BattleRecord, type BattleRow, type BattleSortKey,
    type ClearedFilterValue,
} from './battleFilter';

export const PAGE_SIZE_CHOICES = ['25', '50', '100', '全部'];

// '全部' -> 0 (no paging); anything not a positive integer -> 50.
export function parsePageSize(text: string): number {
    if (text === '全部') return 0;
    const n = parseInt(String(text), 10);
    return Number.isFinite(n) && n > 0 ? n : 50;
}

// size 0 = everything on one page; page is clamped into 1..pageCount.
export function paginate<T>(rows: T[], size: number, page: number): { rows: T[]; pageCount: number; page: number } {
    if (!size) return { rows, pageCount: 1, page: 1 };
    const pageCount = Math.max(1, Math.ceil(rows.length / size));
    const p = Math.max(1, Math.min(page, pageCount));
    return { rows: rows.slice((p - 1) * size, p * size), pageCount, page: p };
}

export interface BattleFilters {
    code?: string | null;
    player?: string | null;
    bossName?: string | null;
    cleared?: ClearedFilterValue | null;
    // datetime-local wall-clock strings.
    from?: string | null;
    to?: string | null;
    clientFrom?: string | null;
    clientTo?: string | null;
}
export interface BattleSort { key: BattleSortKey; dir: 'asc' | 'desc' }

export function pipeline(battles: BattleRecord[], f: BattleFilters, sort: BattleSort): BattleRow[] {
    return sortBattles(
        filterByCleared(
            filterByBossName(
                flattenBattles(filterBattles(battles, {
                    code: f.code ?? undefined,
                    player: f.player ?? undefined,
                    from: toLocalRFC3339(f.from ?? null),
                    to: toLocalRFC3339(f.to ?? null),
                    clientFrom: f.clientFrom || undefined,
                    clientTo: f.clientTo || undefined,
                })),
                f.bossName ?? undefined),
            f.cleared ?? undefined),
        sort.key, sort.dir);
}

// Two-step confirm: arm(key), then act on a second click while isArmed(key).
// The arm lapses by itself after ms.
// onChange (optional) reports the armed key ('' when disarmed) for reactivity.
export function createArmedConfirm(ms = 4000, onChange?: (key: string) => void): { arm(key: string): void; isArmed(key: string): boolean; disarm(): void } {
    let armed = '';
    let timer: ReturnType<typeof setTimeout> | undefined;
    const set = (k: string) => { armed = k; onChange?.(k); };
    const disarm = () => {
        if (timer) { clearTimeout(timer); timer = undefined; }
        set('');
    };
    return {
        arm(key) {
            disarm();
            set(key);
            timer = setTimeout(() => { timer = undefined; set(''); }, ms);
        },
        isArmed: key => armed === key && armed !== '',
        disarm,
    };
}

export const sortedPlayers = (v: BattleRow): BattlePlayer[] =>
    [...(v.players ?? [])].sort((a, b) => b.Dps - a.Dps);

export function partyShare(v: BattleRow, pl: BattlePlayer): string {
    const total = (v.players ?? []).reduce((s, p) => s + p.Damage, 0);
    return total > 0 ? `${(pl.Damage / total * 100).toFixed(1)}%` : '-';
}

// Music-buff column: 戰場的序曲 (680) / 活潑板 (192), mutually exclusive.
const MUSIC_NAMES: Record<number, string> = { 680: '戰場的序曲', 192: '活潑板' };
export const musicIconUrl = (ccId: number) => `/icons/cc/${ccId}.png`;
export const musicTitle = (ccId: number) => MUSIC_NAMES[ccId] ?? String(ccId);

export const BATTLE_COL_LABELS: Record<BattleColKey, string> = {
    startedAt: '開始時間', bossName: 'BOSS 名稱', duration: '戰鬥時間', cleared: '通關',
    player: '角色', dps: '整場DPS', activeDps: '活躍 DPS', partySize: '人數', arcana: '秘法', music: '音樂', client: '遊戲版本',
};

import { describe, it, expect, vi, afterEach } from 'vitest';
import { parsePageSize, paginate, pipeline, createArmedConfirm, partyShare, sortedPlayers } from './battleRecordsView';
import type { BattleRecord, BattleRow } from './battleFilter';

afterEach(() => vi.useRealTimers());

describe('parsePageSize', () => {
    it('全部 is 0, invalid is 50, numbers pass', () => {
        expect(parsePageSize('全部')).toBe(0);
        expect(parsePageSize('abc')).toBe(50);
        expect(parsePageSize('0')).toBe(50);
        expect(parsePageSize('25')).toBe(25);
    });
});

describe('paginate', () => {
    const rows = [1, 2, 3, 4, 5, 6, 7];
    it('clamps the page into range', () => {
        const r = paginate(rows, 3, 9);
        expect(r.pageCount).toBe(3);
        expect(r.page).toBe(3);
        expect(r.rows).toEqual([7]);
    });
    it('size 0 returns everything', () => {
        expect(paginate(rows, 0, 4)).toEqual({ rows, pageCount: 1, page: 1 });
    });
});

describe('createArmedConfirm', () => {
    it('lapses after 4s and disarm clears', () => {
        vi.useFakeTimers();
        const c = createArmedConfirm();
        c.arm('a');
        expect(c.isArmed('a')).toBe(true);
        expect(c.isArmed('b')).toBe(false);
        vi.advanceTimersByTime(3999);
        expect(c.isArmed('a')).toBe(true);
        vi.advanceTimersByTime(2);
        expect(c.isArmed('a')).toBe(false);
        c.arm('b'); c.disarm();
        expect(c.isArmed('b')).toBe(false);
    });
});

describe('pipeline', () => {
    const rec = (file: string, player: string, boss: string, cleared: boolean, t: number): BattleRecord => ({
        file, code: 'brileith', tier: '', player, startedAtLocal: '2026-10-21T10:00:00+08:00', sizeBytes: 1,
        fights: [{ stage: 's', bossRace: 1, bossName: boss, fightStartAt: t, fightEndAt: t + 10, durationSec: 10, cleared, partySize: 1, players: [] }],
    });
    const list = [rec('a', 'X', 'B1', true, 100), rec('b', 'Y', 'B2', false, 200)];
    it('filters then sorts', () => {
        const s = { key: 'startedAt' as const, dir: 'desc' as const };
        expect(pipeline(list, { bossName: 'B2' }, s).map(r => r.file)).toEqual(['b']);
        expect(pipeline(list, { cleared: 'cleared' }, s).map(r => r.file)).toEqual(['a']);
        expect(pipeline(list, {}, s).map(r => r.file)).toEqual(['b', 'a']);
    });
});

describe('party helpers', () => {
    const v = { players: [
        { EntityId: '1', Name: 'a', Arcana: 0, Damage: 300, Dps: 1 },
        { EntityId: '2', Name: 'b', Arcana: 0, Damage: 100, Dps: 5 },
    ] } as BattleRow;
    it('sorts by dps desc and computes share', () => {
        expect(sortedPlayers(v).map(p => p.Name)).toEqual(['b', 'a']);
        expect(partyShare(v, v.players![0])).toBe('75.0%');
        expect(partyShare({ players: [] } as unknown as BattleRow, v.players![0])).toBe('-');
    });
});

describe('createArmedConfirm onChange', () => {
    it('reports arm, lapse and disarm', () => {
        vi.useFakeTimers();
        const seen: string[] = [];
        const c = createArmedConfirm(4000, k => seen.push(k));
        c.arm('a');
        vi.advanceTimersByTime(4001);
        c.arm('b');
        c.disarm();
        expect(seen).toEqual(['', 'a', '', '', 'b', '']);
    });
});

describe('pipeline date range', () => {
    const at = (file: string, local: string): BattleRecord => ({
        file, code: 'brileith', tier: '', player: 'X', startedAtLocal: local, sizeBytes: 1,
    });
    // Same local wall-clock offset as toLocalRFC3339 produces for the test zone.
    const tz = (d: string) => {
        const off = -new Date(d).getTimezoneOffset();
        const a = Math.abs(off);
        return `${d}:00${off >= 0 ? '+' : '-'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
    };
    const list = [at('a', tz('2026-10-20T09:00')), at('b', tz('2026-10-21T09:00')), at('c', tz('2026-10-22T09:00'))];
    const s = { key: 'startedAt' as const, dir: 'asc' as const };
    it('from/to bound the list inclusively', () => {
        expect(pipeline(list, { from: '2026-10-21T00:00', to: '2026-10-21T23:59' }, s).map(r => r.file)).toEqual(['b']);
        expect(pipeline(list, { from: '2026-10-21T09:00' }, s).map(r => r.file)).toEqual(['b', 'c']);
        expect(pipeline(list, { to: '2026-10-21T09:00' }, s).map(r => r.file)).toEqual(['a', 'b']);
    });
});

describe('pipeline client range', () => {
    const rec = (file: string, client?: string): BattleRecord => ({
        file, code: 'c', tier: '', player: 'p', startedAtLocal: '2026-10-21T10:00:00+08:00', sizeBytes: 1, client,
    });
    it('applies clientFrom/clientTo', () => {
        const s = { key: 'startedAt' as const, dir: 'desc' as const };
        const list = [rec('a', 'tw99'), rec('b', 'tw100'), rec('c')];
        expect(pipeline(list, { clientFrom: 'tw100' }, s).map(r => r.file)).toEqual(['b']);
    });
});

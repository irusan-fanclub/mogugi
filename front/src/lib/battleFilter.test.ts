import { describe, it, expect, vi } from 'vitest';
import {
    toLocalRFC3339, filterBattles, humanReadableBytes, distinctOptions,
    formatStartedAt, dungeonDisplayName, sortBattles, personalStats,
    flattenBattles, type BattleRecord, type BattleRow,
} from './battleFilter';

const b = (code: string, tier: string, player: string, startedAtLocal: string) =>
    ({ file: `${code}-${startedAtLocal}`, code, tier, player, startedAtLocal, sizeBytes: 1 });
const list = [
    b('brileith', 'NRD_1S', '磨菇', '2026-08-19T09:00:03+08:00'),
    b('brileith', 'NRD_3S', '磨菇', '2026-08-19T09:00:02+08:00'),
    b('brileith', 'NRD_3S', '哞菇', '2026-08-19T09:00:01+08:00'),
];

describe('filterBattles', () => {
    it('returns everything when no filter is set', () => {
        expect(filterBattles(list, {})).toHaveLength(3);
    });

    it('filters by tier', () => {
        expect(filterBattles(list, { tier: 'NRD_3S' })).toHaveLength(2);
    });

    it('filters by player', () => {
        expect(filterBattles(list, { player: '哞菇' })).toHaveLength(1);
    });

    it('combines filters with AND', () => {
        expect(filterBattles(list, { tier: 'NRD_3S', player: '磨菇' })).toHaveLength(1);
    });

    it('filters by time range inclusively', () => {
        expect(filterBattles(list, {
            from: '2026-08-19T09:00:02+08:00', to: '2026-08-19T09:00:03+08:00',
        })).toHaveLength(2);
    });

    it('returns none when nothing matches', () => {
        expect(filterBattles(list, { player: '沒有這個人' })).toHaveLength(0);
    });
});

describe('humanReadableBytes', () => {
    it('shows sub-KB sizes in bytes', () => {
        expect(humanReadableBytes(0)).toBe('0 B');
        expect(humanReadableBytes(512)).toBe('512 B');
    });

    it('shows KB with two decimals once at or above 1024 bytes', () => {
        expect(humanReadableBytes(1024)).toBe('1.00 KB');
        expect(humanReadableBytes(2048)).toBe('2.00 KB');
    });

    it('shows MB with two decimals once at or above 1024 KB', () => {
        expect(humanReadableBytes(1024 * 1024)).toBe('1.00 MB');
        expect(humanReadableBytes(1536 * 1024)).toBe('1.50 MB');
    });
});

describe('distinctOptions', () => {
    it('collects sorted, deduplicated values via the given picker', () => {
        expect(distinctOptions(list, v => v.tier)).toEqual(['NRD_1S', 'NRD_3S']);
    });

    it('returns an empty array for an empty list', () => {
        expect(distinctOptions([], v => v.code)).toEqual([]);
    });
});

describe('toLocalRFC3339', () => {
    // getTimezoneOffset() reports UTC-minus-local (UTC+8 -> -480), the
    // opposite sign of an RFC3339 offset. Mock it so the assertion is
    // independent of the machine actually running the test.
    it('flips getTimezoneOffset\'s inverted sign for a zone ahead of UTC', () => {
        const spy = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-480);
        expect(toLocalRFC3339('2026-08-19T12:00:00')).toBe('2026-08-19T12:00:00+08:00');
        spy.mockRestore();
    });

    it('flips the sign for a zone behind UTC', () => {
        const spy = vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(300);
        expect(toLocalRFC3339('2026-08-19T12:00:00')).toBe('2026-08-19T12:00:00-05:00');
        spy.mockRestore();
    });

    it('round-trips to the same instant the input represented', () => {
        const v = '2026-08-19T12:00:00';
        const result = toLocalRFC3339(v)!;
        expect(new Date(result).getTime()).toBe(new Date(v).getTime());
    });

    it('returns undefined for empty or unparseable input', () => {
        expect(toLocalRFC3339(null)).toBeUndefined();
        expect(toLocalRFC3339('')).toBeUndefined();
        expect(toLocalRFC3339('not a date')).toBeUndefined();
    });
});

describe('formatStartedAt', () => {
    it('renders RFC3339 wall-clock text as a readable local timestamp', () => {
        expect(formatStartedAt('2026-08-19T09:05:03+08:00')).toBe('2026-08-19 09:05:03');
    });
});

describe('dungeonDisplayName', () => {
    it('maps a known code to its display name', () => {
        expect(dungeonDisplayName('brileith')).toBe('布里萊赫');
    });

    it('falls back to the raw code for an unmapped dungeon', () => {
        expect(dungeonDisplayName('unknown_code')).toBe('unknown_code');
    });
});

describe('flattenBattles', () => {
    it('expands fights to rows and keeps bare files as one row', () => {
        const rows = flattenBattles([
            {
                file: 'a.ndjson', code: 'brileith', tier: 'MRD_1S', player: '毛',
                startedAtLocal: '2026-08-19T20:58:27+08:00', sizeBytes: 1,
                fights: [
                    { stage: 'MRD_1S', bossRace: 7601, bossName: '佩塔克', fightStartAt: 100, fightEndAt: 200, durationSec: 90, partySize: 2, ownerDps: 5, players: [] },
                    { stage: 'MRD_3S', bossRace: 7603, bossName: '雷楠的米勒', fightStartAt: 300, fightEndAt: 400, durationSec: 100, cleared: true, partySize: 2, players: [] },
                ],
            },
            { file: 'b.ndjson', code: 'brileith', tier: 'MRD_1S', player: '毛', startedAtLocal: '2026-08-19T09:00:00+08:00', sizeBytes: 1 },
        ] as BattleRecord[]);
        expect(rows.map(r => r.key)).toEqual(['a.ndjson#MRD_1S', 'a.ndjson#MRD_3S', 'b.ndjson']);
        expect(rows[0].bossName).toBe('佩塔克');
        expect(rows[0].sortTime).toBe(100);
        expect(rows[1].cleared).toBe(true);
        expect(rows[2].bossName).toBeUndefined();
        expect(rows[2].sortTime).toBeGreaterThan(0);
    });
});

describe('sortBattles', () => {
    const rows = [
        { key: 'a', sortTime: 100, ownerDps: 50, durationSec: 100 },
        { key: 'b', sortTime: 300, ownerDps: undefined, durationSec: undefined },
        { key: 'c', sortTime: 200, ownerDps: 80, durationSec: 50 },
    ] as unknown as BattleRow[];

    it('sorts by dps desc with missing values last', () => {
        expect(sortBattles(rows, 'dps', 'desc').map(r => r.key)).toEqual(['c', 'a', 'b']);
    });

    it('sorts by duration asc with missing values last', () => {
        expect(sortBattles(rows, 'duration', 'asc').map(r => r.key)).toEqual(['c', 'a', 'b']);
    });

    it('sorts by start time both ways', () => {
        expect(sortBattles(rows, 'startedAt', 'desc').map(r => r.key)).toEqual(['b', 'c', 'a']);
        expect(sortBattles(rows, 'startedAt', 'asc').map(r => r.key)).toEqual(['a', 'c', 'b']);
    });

    it('does not mutate the input', () => {
        sortBattles(rows, 'dps', 'desc');
        expect(rows.map(r => r.key)).toEqual(['a', 'b', 'c']);
    });
});

describe('personalStats', () => {
    const rows = [
        { key: 'a#1', file: 'a', player: '毛', bossRace: 7603, ownerDps: 50 },
        { key: 'b#1', file: 'b', player: '毛', bossRace: 7603, ownerDps: 80 },
        { key: 'c#1', file: 'c', player: '毛', bossRace: 7602, ownerDps: 10 },
        { key: 'd#1', file: 'd', player: '圓', bossRace: 7603, ownerDps: 99 },
        { key: 'e#1', file: 'e', player: '毛', bossRace: 7603 },
    ] as unknown as BattleRow[];

    it('groups best and average per player+boss', () => {
        const m = personalStats(rows);
        const g = m.get('毛|7603')!;
        expect(g.best).toBe(80);
        expect(g.bestFile).toBe('b#1');
        expect(g.avg).toBe(65);
        expect(g.count).toBe(2);
        expect(m.get('毛|7602')!.best).toBe(10);
        expect(m.get('圓|7603')!.best).toBe(99);
    });
});

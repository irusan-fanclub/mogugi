import { describe, it, expect, vi } from 'vitest';
import {
    toLocalRFC3339, filterBattles, humanReadableBytes, distinctOptions,
    formatStartedAt, dungeonDisplayName, sortBattles, personalStats,
    flattenBattles, filterByBossName, orderPartyArcana, splitOwnerArcana,
    mergeBattleCols, moveBattleCol, DEFAULT_BATTLE_COLS,
    type BattleRecord, type BattleRow, type BattlePlayer, type BattleColState,
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

    it('filters by player', () => {
        expect(filterBattles(list, { player: '哞菇' })).toHaveLength(1);
    });

    it('combines filters with AND', () => {
        expect(filterBattles(list, {
            player: '磨菇', from: '2026-08-19T09:00:03+08:00',
        })).toHaveLength(1);
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
        expect(distinctOptions([] as BattleRecord[], v => v.code)).toEqual([]);
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
                    { stage: 'MRD_1S', bossRace: 7601, bossName: '佩塔克', fightStartAt: 100, fightEndAt: 200, durationSec: 90, partySize: 2, ownerDps: 5, musicCcId: 680, musicPct: 8, players: [] },
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

    it('copies musicCcId/musicPct from the fight, leaving them undefined when absent', () => {
        const rows = flattenBattles([
            {
                file: 'a.ndjson', code: 'brileith', tier: 'MRD_1S', player: '毛',
                startedAtLocal: '2026-08-19T20:58:27+08:00', sizeBytes: 1,
                fights: [
                    { stage: 'MRD_1S', bossRace: 7601, bossName: '佩塔克', fightStartAt: 100, fightEndAt: 200, durationSec: 90, partySize: 2, musicCcId: 192, musicPct: 12.5, players: [] },
                    { stage: 'MRD_2S', bossRace: 7602, bossName: '布倫塔納斯', fightStartAt: 300, fightEndAt: 400, durationSec: 90, partySize: 2, players: [] },
                ],
            },
        ] as BattleRecord[]);
        expect(rows[0].musicCcId).toBe(192);
        expect(rows[0].musicPct).toBe(12.5);
        expect(rows[1].musicCcId).toBeUndefined();
        expect(rows[1].musicPct).toBeUndefined();
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
    // f/g have higher DPS than a/b but must not win best/avg: f is an
    // explicit wipe and g is an old un-backfilled fight (cleared undefined).
    const rows = [
        { key: 'a#1', file: 'a', player: '毛', bossRace: 7603, ownerDps: 50, cleared: true },
        { key: 'b#1', file: 'b', player: '毛', bossRace: 7603, ownerDps: 80, cleared: true },
        { key: 'c#1', file: 'c', player: '毛', bossRace: 7602, ownerDps: 10, cleared: true },
        { key: 'd#1', file: 'd', player: '圓', bossRace: 7603, ownerDps: 99, cleared: true },
        { key: 'e#1', file: 'e', player: '毛', bossRace: 7603, cleared: true },
        { key: 'f#1', file: 'f', player: '毛', bossRace: 7603, ownerDps: 300, cleared: false },
        { key: 'g#1', file: 'g', player: '毛', bossRace: 7603, ownerDps: 999 },
    ] as unknown as BattleRow[];

    it('groups best and average per player+boss, counting only cleared fights', () => {
        const m = personalStats(rows);
        const g = m.get('毛|7603')!;
        expect(g.best).toBe(80);
        expect(g.bestFile).toBe('b#1');
        expect(g.avg).toBe(65);
        expect(g.count).toBe(2);
        expect(m.get('毛|7602')!.best).toBe(10);
        expect(m.get('圓|7603')!.best).toBe(99);
    });

    it('excludes wipes and un-flagged (old-file) fights even at higher DPS', () => {
        const m = personalStats(rows);
        expect(m.get('毛|7603')!.best).not.toBe(300);
        expect(m.get('毛|7603')!.best).not.toBe(999);
    });
});

describe('filterByBossName', () => {
    const rows = [
        { key: 'a#1', bossName: '佩塔克' },
        { key: 'b#1', bossName: '雷楠的米勒' },
        { key: 'c#1', bossName: '佩塔克' },
        { key: 'd#1' },
    ] as unknown as BattleRow[];

    it('returns everything when no boss name is set', () => {
        expect(filterByBossName(rows, undefined)).toHaveLength(4);
    });

    it('keeps only rows matching the given boss name', () => {
        expect(filterByBossName(rows, '佩塔克').map(r => r.key)).toEqual(['a#1', 'c#1']);
    });

    it('excludes rows with no boss name when a filter is set', () => {
        expect(filterByBossName(rows, '佩塔克').some(r => r.key === 'd#1')).toBe(false);
    });
});

describe('orderPartyArcana', () => {
    const players: BattlePlayer[] = [
        { EntityId: '1', Name: '哞菇', Arcana: 2, Damage: 500, Dps: 10 },
        { EntityId: '2', Name: '磨菇', Arcana: 1, Damage: 300, Dps: 5 },
        { EntityId: '3', Name: '圓', Arcana: 3, Damage: 800, Dps: 20 },
    ];

    it('puts the recording player first, then the rest by damage desc', () => {
        expect(orderPartyArcana(players, '磨菇').map(p => p.Name)).toEqual(['磨菇', '圓', '哞菇']);
    });

    it('falls back to damage-desc order when the recording player is not found', () => {
        expect(orderPartyArcana(players, '不存在').map(p => p.Name)).toEqual(['圓', '哞菇', '磨菇']);
    });

    it('handles an empty party', () => {
        expect(orderPartyArcana([], '磨菇')).toEqual([]);
    });
});

describe('splitOwnerArcana', () => {
    const players: BattlePlayer[] = [
        { EntityId: '1', Name: '哞菇', Arcana: 2, Damage: 500, Dps: 10 },
        { EntityId: '2', Name: '磨菇', Arcana: 1, Damage: 300, Dps: 5 },
        { EntityId: '3', Name: '圓', Arcana: 3, Damage: 800, Dps: 20 },
    ];

    it('splits the owner (by name) from teammates ordered by damage desc', () => {
        const { owner, teammates } = splitOwnerArcana(players, '磨菇');
        expect(owner?.Name).toBe('磨菇');
        expect(teammates.map(p => p.Name)).toEqual(['圓', '哞菇']);
    });

    it('has no owner when the owner has no arcana, putting everyone in teammates', () => {
        const noArcanaOwner = players.map(p => p.Name === '磨菇' ? { ...p, Arcana: 0 } : p);
        const { owner, teammates } = splitOwnerArcana(noArcanaOwner, '磨菇');
        expect(owner).toBeUndefined();
        expect(teammates.map(p => p.Name)).toEqual(['圓', '哞菇']);
    });

    it('has no teammates when only the owner has arcana', () => {
        const soloArcana = players.map(p => p.Name === '磨菇' ? p : { ...p, Arcana: 0 });
        const { owner, teammates } = splitOwnerArcana(soloArcana, '磨菇');
        expect(owner?.Name).toBe('磨菇');
        expect(teammates).toEqual([]);
    });

    it('has no owner when the recording player is not in the party', () => {
        const { owner, teammates } = splitOwnerArcana(players, '不存在');
        expect(owner).toBeUndefined();
        expect(teammates.map(p => p.Name)).toEqual(['圓', '哞菇', '磨菇']);
    });

    it('handles an empty party', () => {
        expect(splitOwnerArcana([], '磨菇')).toEqual({ owner: undefined, teammates: [] });
    });
});

describe('mergeBattleCols', () => {
    const defaults = ['a', 'b', 'c'] as unknown as typeof DEFAULT_BATTLE_COLS;

    it('returns all-visible defaults in order when nothing is stored', () => {
        expect(mergeBattleCols(null, defaults)).toEqual([
            { key: 'a', visible: true }, { key: 'b', visible: true }, { key: 'c', visible: true },
        ]);
        expect(mergeBattleCols(undefined, defaults)).toEqual(mergeBattleCols(null, defaults));
    });

    it('keeps stored order and visibility when it matches the current defaults', () => {
        const stored = [
            { key: 'c', visible: false }, { key: 'a', visible: true }, { key: 'b', visible: true },
        ] as unknown as BattleColState[];
        expect(mergeBattleCols(stored, defaults)).toEqual(stored);
    });

    it('drops a stored column that no longer exists in defaults', () => {
        const stored = [
            { key: 'a', visible: true }, { key: 'removed', visible: true }, { key: 'b', visible: false },
        ] as unknown as BattleColState[];
        expect(mergeBattleCols(stored, defaults)).toEqual([
            { key: 'a', visible: true }, { key: 'b', visible: false }, { key: 'c', visible: true },
        ]);
    });

    it('appends a new default column not present in storage, visible by default', () => {
        const stored = [{ key: 'b', visible: false }, { key: 'a', visible: true }] as unknown as BattleColState[];
        expect(mergeBattleCols(stored, defaults)).toEqual([
            { key: 'b', visible: false }, { key: 'a', visible: true }, { key: 'c', visible: true },
        ]);
    });

    it('treats an empty stored array the same as nothing stored', () => {
        expect(mergeBattleCols([], defaults)).toEqual(mergeBattleCols(null, defaults));
    });
});

describe('moveBattleCol', () => {
    const cols = [
        { key: 'a', visible: true }, { key: 'b', visible: true },
        { key: 'c', visible: true }, { key: 'd', visible: true },
    ] as unknown as BattleColState[];

    it('moves an item forward', () => {
        expect(moveBattleCol(cols, 0, 2).map(c => c.key)).toEqual(['b', 'c', 'a', 'd']);
    });

    it('moves an item backward', () => {
        expect(moveBattleCol(cols, 3, 1).map(c => c.key)).toEqual(['a', 'd', 'b', 'c']);
    });

    it('is a no-op (but still returns a copy) when from equals to', () => {
        const result = moveBattleCol(cols, 1, 1);
        expect(result).toEqual(cols);
        expect(result).not.toBe(cols);
    });

    it('does not mutate the input', () => {
        moveBattleCol(cols, 0, 3);
        expect(cols.map(c => c.key)).toEqual(['a', 'b', 'c', 'd']);
    });

    it('clamps an out-of-range from index to a no-op copy', () => {
        expect(moveBattleCol(cols, -1, 2)).toEqual(cols);
        expect(moveBattleCol(cols, 10, 2)).toEqual(cols);
    });
});

import { describe, it, expect } from 'vitest';
import { buildTargetList, hideTarget, pickNewBoss, targetLabel, targetShortLabel, titleBoss } from './targets';

const races: Record<string, number> = { a: 4856, b: 100, c: 100, d: 0 };
const raceOf = (id: string) => races[id] ?? -1;
const isBoss = (r: number) => r === 4856;

describe('buildTargetList', () => {
    const base = {
        totals: { a: 50, b: 10, c: 30, d: 5 }, total: 95,
        hiddenIds: new Set<string>(), hiddenRaces: new Set<number>(), bossOnly: false, raceOf, isBoss,
    };
    it("puts '' first then sorts by damage desc", () => {
        expect(buildTargetList(base).map(e => e[0])).toEqual(['', 'a', 'c', 'b', 'd']);
        expect(buildTargetList(base)[0]).toEqual(['', 95]);
    });
    it('hides ids and whole races', () => {
        const l = buildTargetList({ ...base, hiddenIds: new Set(['d']), hiddenRaces: new Set([100]) });
        expect(l.map(e => e[0])).toEqual(['', 'a']);
    });
    it('drops allies (players and pets) but keeps the all entry', () => {
        const l = buildTargetList({ ...base, isAlly: id => id === 'b' || id === 'c' });
        expect(l.map(e => e[0])).toEqual(['', 'a', 'd']);
    });
    it("bossOnly keeps '' and bosses", () => {
        expect(buildTargetList({ ...base, bossOnly: true }).map(e => e[0])).toEqual(['', 'a']);
        expect(buildTargetList({ ...base, bossOnly: true, totals: {} }).map(e => e[0])).toEqual(['']);
    });
});

describe('hideTarget', () => {
    it('hides the whole race when race > 0', () => {
        const s = { ids: new Set<string>(), races: new Set<number>() };
        hideTarget(s, 'b', raceOf);
        expect([...s.races]).toEqual([100]);
        expect(s.ids.size).toBe(0);
    });
    it('hides only the id for race 0 or unknown', () => {
        const s = { ids: new Set<string>(), races: new Set<number>() };
        hideTarget(s, 'd', raceOf);
        hideTarget(s, 'zz', raceOf);
        expect([...s.ids]).toEqual(['d', 'zz']);
        expect(s.races.size).toBe(0);
    });
});

describe('pickNewBoss', () => {
    it('returns the last unseen boss and records it', () => {
        const seen = new Set<string>(['a']);
        expect(pickNewBoss(['a', 'x', 'y', 'b'], seen, id => id === 'a' || id === 'x' || id === 'y')).toBe('y');
        expect(seen.has('x') && seen.has('y')).toBe(true);
        expect(pickNewBoss(['a', 'x', 'y'], seen, () => true)).toBeNull();
    });
});

describe('targetLabel', () => {
    const opts = {
        isBossRace: isBoss, raceName: (r: number) => `R${r}`,
        prettyName: (a?: { name?: string }) => a?.name,
    };
    it('all entry', () => {
        expect(targetLabel(['', 47000], undefined, opts)).toBe('全部目標（傷害 47.00K）');
    });
    const at = new Date(2026, 0, 2, 3, 4, 5).getTime() / 1000;
    const mob = (over: object) => ({ raceId: 100, name: 'Gob', appearAt: at, maxLife: 5000, downAt: null, killedAt: null, everFinished: false, ...over }) as never;
    it('mobs and bosses share "time name (race) -- HP" plus a kill mark', () => {
        expect(targetLabel(['b', 2000], mob({}), opts)).toBe('2026-01-02 03:04:05 R100 (100) -- 5.00K ❌');
        expect(targetLabel(['b', 2000], mob({ killedAt: at + 3 }), opts)).toBe('2026-01-02 03:04:05 R100 (100) -- 5.00K ✅');
        expect(targetLabel(['a', 1], mob({ raceId: 4856, downAt: at + 9 }), opts)).toBe('2026-01-02 03:04:05 R4856 (4856) -- 5.00K ✅');
    });
    it('an older log without the killing-blow flag judges kills by the finisher', () => {
        expect(targetLabel(['b', 1], mob({ everFinished: true }), opts)).toMatch(/❌$/);
        expect(targetLabel(['b', 1], mob({ everFinished: true }), { ...opts, finisherFallback: true })).toMatch(/✅$/);
    });
    it('falls back to the pretty name, and to the id without an actor', () => {
        const o = { ...opts, raceName: () => undefined };
        expect(targetLabel(['b', 2000], mob({ appearAt: undefined, maxLife: undefined }), o)).toBe('Gob (100) ❌');
        expect(targetLabel(['q', 2000], undefined, opts)).toBe('q');
    });
});

describe('targetShortLabel', () => {
    const opts = {
        isBossRace: isBoss, raceName: (r: number) => `R${r} ${r}`,
        prettyName: (a?: { name?: string }) => a?.name,
    };
    it('is appear date and time then name, without HP, like the menu', () => {
        const at = new Date(2026, 0, 2, 3, 4, 5).getTime() / 1000;
        expect(targetShortLabel({ raceId: 4856, appearAt: at, maxLife: 1000 } as never, opts)).toBe('2026-01-02 03:04:05 R4856');
        expect(targetShortLabel({ raceId: 100, name: 'Gob', appearAt: at } as never, opts)).toBe('2026-01-02 03:04:05 Gob');
    });
    it('boss without appear time is just the name', () => {
        expect(targetShortLabel({ raceId: 4856 } as never, opts)).toBe('R4856');
    });
    it('others use the pretty name, no damage', () => {
        expect(targetShortLabel({ raceId: 100, name: 'Gob' } as never, opts)).toBe('Gob');
    });
});

describe('titleBoss', () => {
    const actors: any = {
        a: { raceId: 4856, appearAt: 5 }, b: { raceId: 4856, appearAt: 9 }, c: { raceId: 1, appearAt: 99 },
    };
    it('selected boss wins', () => {
        expect(titleBoss({ selected: actors.a, actors, isBoss })).toBe(actors.a);
    });
    it('else latest appeared boss', () => {
        expect(titleBoss({ selected: null, actors, isBoss })).toBe(actors.b);
        expect(titleBoss({ selected: actors.c, actors, isBoss })).toBe(actors.b);
    });
    it('null with no boss', () => {
        expect(titleBoss({ selected: null, actors: {}, isBoss })).toBeNull();
    });
});

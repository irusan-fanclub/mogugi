import { describe, it, expect } from 'vitest';
import { ActorManager, type EntityActor } from '@/eventActor';
import { DamageCollectorManager } from '@/actionCollector';
import type { eventBase } from '@/protocols';
import { buildCooldownRows, READY_KEEP_SEC } from './skillCooldown';

const base = { Height: 1, Weight: 1, Upper: 1, Lower: 1, GuildName: '', OwnerId: '' };

function world() {
    const mgr = new ActorManager(new DamageCollectorManager());
    const appear = (Id: string, RaceId: number, Name: string) =>
        mgr.onEvent({ EventId: 1, At: 1, Id, Name, RaceId, ...base } as unknown as eventBase);
    const cast = (Id: string, At: number, DisableAt: number, AttackerId: string) =>
        mgr.onEvent({ EventId: 4, At, Id, CCId: 803, DisableAt, AttackerId, Params: {} } as unknown as eventBase);
    appear('p', 10002, 'Alice');
    appear('q', 10002, 'Bob');
    appear('b1', 4856, 'Boss1');
    appear('b2', 4856, 'Boss2');
    return { mgr, cast, actors: () => mgr.entityMap as Record<string, EntityActor> };
}
const rows = (w: ReturnType<typeof world>, now: number) =>
    buildCooldownRows({ actors: w.actors(), now, nameOf: id => `n${id}` });

describe('buildCooldownRows', () => {
    it('de-duplicates casts within 10s and counts the last counted cast', () => {
        const w = world();
        w.cast('b1', 100, 160, 'p'); w.cast('b2', 104, 164, 'p'); w.cast('b1', 400, 460, 'p');
        expect(rows(w, 450)).toEqual([{ id: 'p', name: 'np', skillId: 59005, remaining: 130 }]);
    });
    it('is ready (0) after the cooldown', () => {
        const w = world();
        w.cast('b1', 100, 160, 'p'); w.cast('b1', 400, 460, 'p');
        expect(rows(w, 700)[0].remaining).toBe(0);
    });
    it('drops a row once it has been ready for READY_KEEP_SEC', () => {
        const w = world();
        w.cast('b1', 100, 160, 'p');
        expect(rows(w, 280 + READY_KEEP_SEC)).toHaveLength(1);
        expect(rows(w, 281 + READY_KEEP_SEC)).toEqual([]);
    });
    it('ignores non-PC attackers', () => {
        const w = world();
        w.cast('b1', 100, 160, 'b2');
        expect(rows(w, 150)).toEqual([]);
    });
    it('a replayed identical enable adds no row and keeps the remaining', () => {
        const w = world();
        w.cast('b1', 100, 160, 'p');
        const n = w.actors()['b1'].casts.length;
        w.cast('b1', 100, 160, 'p');
        expect(w.actors()['b1'].casts.length).toBe(n);
        w.cast('b1', 130, 160, 'p');
        expect(w.actors()['b1'].casts.length).toBe(n);
        expect(rows(w, 150)).toEqual([{ id: 'p', name: 'np', skillId: 59005, remaining: 130 }]);
    });
    it('sorts by remaining then name', () => {
        const w = world();
        w.cast('b1', 100, 160, 'q'); w.cast('b1', 50, 110, 'p');
        expect(rows(w, 150).map(r => r.id)).toEqual(['p', 'q']);
    });

    // Mirrors the overlay current-only backlog: the snapshot enable (deduped away) plus the in-segment one,
    // or, when the segment never re-enables, a snapshot enable stamped At 0.
    it('overlay backlog gives the same cooldown rows as the full stream', () => {
        const full = world();
        full.cast('b1', 1000, 1180, 'p');
        const cur = world();
        cur.cast('b1', 1000, 1180, 'p');
        expect(rows(cur, 1100)).toEqual(rows(full, 1100));

        const old = world();
        old.cast('b2', 0, 1180, 'q');
        expect(rows(old, 1100)).toEqual([]);
    });
});

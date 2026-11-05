import { describe, it, expect } from 'vitest';
import { ActorManager, type EntityActor } from '@/eventActor';
import { DamageCollectorManager } from '@/actionCollector';
import type { eventBase } from '@/protocols';
import type { CooldownSkill } from './overlaySettings';
import { createCooldownTracker, CAST_DEDUPE_SEC, READY_KEEP_SEC, UNTRACKED_KEEP_SEC } from './skillCooldown';

const base = { Height: 1, Weight: 1, Upper: 1, Lower: 1, GuildName: '', OwnerId: '' };
const BY_CC: CooldownSkill = { skillId: 59005, cooldownSec: 180, ccId: 803 };
const BY_CAST: CooldownSkill = { skillId: 20018, cooldownSec: 30, ccId: 0 };

function world(skills: CooldownSkill[] = [BY_CC]) {
    const mgr = new ActorManager(new DamageCollectorManager());
    const appear = (Id: string, RaceId: number, Name: string) =>
        mgr.onEvent({ EventId: 1, At: 1, Id, Name, RaceId, ...base } as unknown as eventBase);
    const cast = (Id: string, At: number, DisableAt: number, AttackerId: string) =>
        mgr.onEvent({ EventId: 4, At, Id, CCId: 803, DisableAt, AttackerId, Params: {} } as unknown as eventBase);
    const use = (Id: string, At: number, SkillId = 20018) =>
        mgr.onEvent({ EventId: 17, At, Id, SkillId } as unknown as eventBase);
    appear('p', 10002, 'Alice');
    appear('q', 10002, 'Bob');
    appear('b1', 4856, 'Boss1');
    appear('b2', 4856, 'Boss2');
    const t = createCooldownTracker();
    const actors = () => mgr.entityMap as Record<string, EntityActor>;
    const rows = (now: number, owner = '', list = skills) => {
        t.observe(actors(), list, id => `n${id}`);
        return t.rows(now, list, owner);
    };
    const belief = (Id: string, At: number) =>
        mgr.onEvent({ EventId: 4, At, Id, CCId: 428, DisableAt: At + 30, AttackerId: Id, Params: {} } as unknown as eventBase);
    return { mgr, t, cast, use, belief, rows };
}
const one = (id: string, skillId: number, remaining: number, total: number) =>
    ({ id, name: `n${id}`, isSelf: false, skills: [{ skillId, remaining, total }] });

describe('cooldown tracker (CC trigger)', () => {
    it('de-duplicates casts within 10s and counts the last counted cast', () => {
        const w = world();
        w.cast('b1', 100, 160, 'p'); w.cast('b2', 104, 164, 'p'); w.cast('b1', 400, 460, 'p');
        expect(w.rows(450)).toEqual([one('p', 59005, 130, 180)]);
    });
    it('is ready (0) after the cooldown', () => {
        const w = world();
        w.cast('b1', 100, 160, 'p'); w.cast('b1', 400, 460, 'p');
        expect(w.rows(700)[0].skills[0].remaining).toBe(0);
    });
    it('drops a row once it has been ready for READY_KEEP_SEC', () => {
        const w = world();
        w.cast('b1', 100, 160, 'p');
        expect(w.rows(280 + READY_KEEP_SEC)).toHaveLength(1);
        expect(w.rows(281 + READY_KEEP_SEC)).toEqual([]);
    });
    it('ignores non-PC attackers', () => {
        const w = world();
        w.cast('b1', 100, 160, 'b2');
        expect(w.rows(150)).toEqual([]);
    });
    it('sorts the owner first, then by remaining', () => {
        const w = world();
        w.cast('b1', 100, 160, 'q'); w.cast('b1', 50, 110, 'p');
        expect(w.rows(150).map(r => r.id)).toEqual(['p', 'q']);
        expect(w.rows(150, 'q').map(r => r.id)).toEqual(['q', 'p']);
    });
    it('keeps the rows after the history is evicted at a battle boundary', () => {
        const w = world();
        w.cast('b1', 100, 160, 'p');
        expect(w.rows(150)).toHaveLength(1);
        w.mgr.evictBefore(200);
        expect(w.rows(210)).toEqual([one('p', 59005, 70, 180)]);
    });
});

describe('cooldown tracker (cast trigger)', () => {
    it('starts on a cast of the skill and groups skills per player', () => {
        const w = world([BY_CC, BY_CAST]);
        w.use('p', 100); w.cast('b1', 100, 160, 'p');
        expect(w.rows(110)).toEqual([{
            id: 'p', name: 'np', isSelf: false,
            skills: [{ skillId: 59005, remaining: 170, total: 180 }, { skillId: 20018, remaining: 20, total: 30 }],
        }]);
    });
    it('a short cooldown dedupes within half of it, not 10s', () => {
        const w = world([{ ...BY_CAST, cooldownSec: 8 }]);
        w.use('p', 100); w.use('p', 103); w.use('p', 105);
        expect(w.rows(106)[0].skills[0].remaining).toBe(7);
    });
    it('ignores other skills and non-PCs', () => {
        const w = world([BY_CAST]);
        w.use('p', 100, 1); w.use('b1', 100);
        expect(w.rows(110)).toEqual([]);
    });
    it('a re-sent history (reconnect) does not restart the cooldown', () => {
        const w = world([BY_CAST]);
        w.use('p', 100);
        expect(w.rows(110)[0].skills[0].remaining).toBe(20);
        w.mgr.clear();
        w.use('p', 100);
        expect(w.rows(110)[0].skills[0].remaining).toBe(20);
    });
});

describe('cooldown tracker (skills enabled later)', () => {
    const SK: CooldownSkill = { skillId: 59143, cooldownSec: 60, ccId: 0 };
    it('a cast before the skill is enabled shows up after enabling', () => {
        const w = world([]);
        w.use('p', 100, 59143);
        expect(w.rows(105)).toEqual([]);
        expect(w.rows(110, '', [SK])).toEqual([one('p', 59143, 50, 60)]);
    });
    it('a CC-started cooldown before it is enabled shows up after enabling', () => {
        const w = world([]);
        w.cast('b1', 100, 160, 'p');
        expect(w.rows(105)).toEqual([]);
        expect(w.rows(110, '', [BY_CC])).toEqual([one('p', 59005, 170, 180)]);
    });
    it('an untracked skill dedupes within CAST_DEDUPE_SEC', () => {
        const w = world([]);
        w.use('p', 100, 59143); w.use('p', 100 + CAST_DEDUPE_SEC - 1, 59143);
        expect(w.rows(110)).toEqual([]);
        expect(w.rows(110, '', [SK])).toEqual([one('p', 59143, 50, 60)]);
    });
});

const SK60: CooldownSkill = { skillId: 59143, cooldownSec: 60, ccId: 0 };

describe('cooldown tracker (bounded state)', () => {
    it('drops entries long past ready, tracked or not', () => {
        const w = world([BY_CAST]);
        w.use('p', 100); w.use('p', 100, 59143); w.cast('b1', 100, 160, 'p');
        w.rows(110);
        expect(w.t.size()).toBe(3);
        w.rows(100 + 30 + READY_KEEP_SEC + 1);
        expect(w.t.size()).toBe(2);
        w.rows(100 + UNTRACKED_KEEP_SEC + 1);
        expect(w.t.size()).toBe(0);
    });
    it('skip marks everything read without counting it', () => {
        const w = world([BY_CC, SK60]);
        w.use('p', 100, 59143);
        expect(w.rows(110)).toHaveLength(1);
        w.cast('b1', 105, 165, 'p'); w.belief('p', 108);
        w.t.skip(w.mgr.entityMap as Record<string, EntityActor>);
        expect(w.rows(110)).toEqual([one('p', 59143, 50, 60)]);
    });

    it('reset forgets every row and does not recount uses already read', () => {
        const w = world([BY_CAST]);
        w.use('p', 100);
        expect(w.rows(110)).toHaveLength(1);
        w.t.reset();
        expect(w.rows(110)).toEqual([]);
        expect(w.t.size()).toBe(0);
        w.use('p', 120);
        expect(w.rows(125)).toEqual([one('p', 20018, 25, 30)]);
    });
});

describe('cooldown tracker (信念值強化 reset)', () => {
    const SK: CooldownSkill = { skillId: 59143, cooldownSec: 60, ccId: 0 };
    const NOR: CooldownSkill = { skillId: 59086, cooldownSec: 60, ccId: 0 };
    const rem = (w: ReturnType<typeof world>, now: number, owner: string, sid = 59143) =>
        w.rows(now).find(r => r.id === owner)?.skills.find(s => s.skillId === sid)?.remaining;
    it('makes a used skill ready from the 428 start', () => {
        const w = world([SK]);
        w.use('p', 100, 59143); w.belief('p', 110);
        expect(rem(w, 115, 'p')).toBe(0);
    });
    it('a cast after the reset counts down again', () => {
        const w = world([SK]);
        w.use('p', 100, 59143); w.belief('p', 110); w.use('p', 120, 59143);
        expect(rem(w, 130, 'p')).toBe(50);
    });
    it('428 on another player does not reset this one', () => {
        const w = world([SK]);
        w.use('p', 100, 59143); w.belief('q', 110);
        expect(rem(w, 115, 'p')).toBe(45);
    });
    it('a 428 start before the cast does not reset it', () => {
        const w = world([SK]);
        w.belief('p', 90); w.use('p', 100, 59143);
        expect(rem(w, 115, 'p')).toBe(45);
    });
    it('skills tagged no_cooltime_reset_by_tuairim keep counting down', () => {
        const w = world([SK, NOR]);
        w.use('p', 100, 59086); w.use('p', 100, 59143); w.belief('p', 110);
        expect(rem(w, 115, 'p', 59086)).toBe(45);
        expect(rem(w, 115, 'p', 59143)).toBe(0);
    });
});

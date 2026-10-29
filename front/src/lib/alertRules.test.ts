import { describe, expect, it } from 'vitest';
import type { EntityActor } from '@/eventActor';
import type { AlertRule } from './overlaySettings';
import { createAlertTracker, fillMessage } from './alertRules';

const OVERTURE = 1001;
const TUAN = 680;
const SOUL = 681;

type Conds = Record<number, number>;
function actors(map: Record<string, Conds>): Record<string, EntityActor> {
    const out: Record<string, EntityActor> = {};
    for (const [id, conds] of Object.entries(map)) {
        const conditionMap: Record<number, { DisableAt: number }> = {};
        for (const [cc, d] of Object.entries(conds)) conditionMap[Number(cc)] = { DisableAt: d };
        out[id] = { conditionMap } as unknown as EntityActor;
    }
    return out;
}
function rule(p: Partial<AlertRule> = {}): AlertRule {
    return {
        id: 'r1', enabled: true, kind: 'countdown', target: 'self', ccId: OVERTURE, times: [25, 15, 5], every: 30,
        conds: [], join: 'and', text: true, textMessage: '', voice: true, voiceMessage: '', textKeep: 5,
        dismiss: { condFails: false, ccEnds: false, replaced: false }, ...p,
    };
}
function input(a: Record<string, EntityActor>, now: number, rules: AlertRule[], over: Partial<{ partyIds: string[] }> = {}) {
    return {
        now, actors: a, ownerId: 'me', partyIds: over.partyIds ?? ['me'], bossId: 'boss', rules,
        nameOf: (id: string) => `name-${id}`, ccNameOf: (c: number) => `cc-${c}`,
    };
}
const secs = (s: { fires: { sec: number }[] }) => s.fires.map(f => f.sec);

describe('alertRules', () => {
    it('fires once per crossing', () => {
        const t = createAlertTracker();
        const a = actors({ me: { [OVERTURE]: 130 } });
        const r = [rule()];
        expect(secs(t.step(input(a, 100, r)))).toEqual([]);
        expect(secs(t.step(input(a, 106, r)))).toEqual([25]);
        expect(secs(t.step(input(a, 116, r)))).toEqual([15]);
        expect(secs(t.step(input(a, 126, r)))).toEqual([5]);
        expect(secs(t.step(input(a, 126, r)))).toEqual([]);
    });

    it('no backfill', () => {
        const t = createAlertTracker();
        const a = actors({ me: { [OVERTURE]: 130 } });
        const r = [rule()];
        expect(secs(t.step(input(a, 120, r)))).toEqual([]);
        expect(secs(t.step(input(a, 125, r)))).toEqual([5]);
    });

    it('recast resets', () => {
        const t = createAlertTracker();
        const r = [rule()];
        t.step(input(actors({ me: { [OVERTURE]: 130 } }), 100, r));
        expect(secs(t.step(input(actors({ me: { [OVERTURE]: 130 } }), 106, r)))).toEqual([25]);
        const re = actors({ me: { [OVERTURE]: 200 } });
        t.step(input(re, 107, r));
        expect(secs(t.step(input(re, 176, r)))).toEqual([25]);
    });

    it('condition absent on same actor', () => {
        const t = createAlertTracker();
        const r = [rule({ conds: [{ mode: 'absent', ccId: SOUL }] })];
        const a = actors({ me: { [OVERTURE]: 130, [SOUL]: 500 }, p1: {} });
        t.step(input(a, 100, r));
        const s = t.step(input(a, 106, r));
        expect(s.fires).toEqual([]);
        expect(s.red.size).toBe(0);

        const b = actors({ me: { [OVERTURE]: 130 }, p1: { [SOUL]: 500 } });
        const t2 = createAlertTracker();
        t2.step(input(b, 100, r));
        const s2 = t2.step(input(b, 106, r));
        expect(secs(s2)).toEqual([25]);
        expect(s2.red.has(`me:${OVERTURE}`)).toBe(true);
    });

    it('condition present requires it, and consumes the time point when unmet', () => {
        const t = createAlertTracker();
        const r = [rule({ conds: [{ mode: 'present', ccId: TUAN }] })];
        const a = actors({ me: { [OVERTURE]: 130 } });
        t.step(input(a, 100, r));
        expect(t.step(input(a, 106, r)).fires).toEqual([]);
        const b = actors({ me: { [OVERTURE]: 130, [TUAN]: 0 } });
        expect(t.step(input(b, 107, r)).fires).toEqual([]);
        expect(secs(t.step(input(b, 116, r)))).toEqual([15]);
    });

    it('party each member', () => {
        const t = createAlertTracker();
        const a = actors({ me: { [OVERTURE]: 130 }, p1: { [OVERTURE]: 130 }, p2: { [OVERTURE]: 130 } });
        const r = [rule({ target: 'party', textMessage: '{名字}:{秒}' })];
        const ip = { partyIds: ['me', 'p1', 'p2'] };
        t.step(input(a, 100, r, ip));
        const s = t.step(input(a, 106, r, ip));
        expect(s.fires.map(f => [f.actorId, f.text])).toEqual([['p1', 'name-p1:25'], ['p2', 'name-p2:25']]);
    });

    it('all covers self and every member', () => {
        const t = createAlertTracker();
        const a = actors({ me: { [OVERTURE]: 130 }, p1: { [OVERTURE]: 130 } });
        const r = [rule({ target: 'all', textMessage: '{名字}:{秒}' })];
        const ip = { partyIds: ['p1', 'me'] };
        t.step(input(a, 100, r, ip));
        const s = t.step(input(a, 106, r, ip));
        expect(s.fires.map(f => [f.actorId, f.text])).toEqual([['me', 'name-me:25'], ['p1', 'name-p1:25']]);
    });

    it('all includes self before self has dealt damage', () => {
        const t = createAlertTracker();
        const a = actors({ me: { [OVERTURE]: 130 } });
        const r = [rule({ target: 'all' })];
        t.step(input(a, 100, r, { partyIds: [] }));
        expect(secs(t.step(input(a, 106, r, { partyIds: [] })))).toEqual([25]);
    });

    it('time going backwards resets tracking', () => {
        const t = createAlertTracker();
        const a = actors({ me: { [OVERTURE]: 130 } });
        const r = [rule()];
        t.step(input(a, 100, r));
        expect(secs(t.step(input(a, 106, r)))).toEqual([25]);
        expect(secs(t.step(input(a, 90, r)))).toEqual([]);
        expect(secs(t.step(input(a, 106, r)))).toEqual([25]);
    });

    it('disabled rules neither fire nor turn red', () => {
        const t = createAlertTracker();
        const a = actors({ me: { [OVERTURE]: 130 } });
        const r = [rule({ enabled: false })];
        t.step(input(a, 100, r));
        const s = t.step(input(a, 126, r));
        expect(s.fires).toEqual([]);
        expect(s.red.size).toBe(0);
    });

    it('turns red within max(times), not for DisableAt 0', () => {
        const t = createAlertTracker();
        const r = [rule()];
        const a = actors({ me: { [OVERTURE]: 130 } });
        expect(t.step(input(a, 100, r)).red.size).toBe(0);
        expect(t.step(input(a, 105, r)).red.has(`me:${OVERTURE}`)).toBe(true);
        const forever = actors({ me: { [OVERTURE]: 0 } });
        const s = t.step(input(forever, 110, r));
        expect(s.red.size).toBe(0);
        expect(s.fires).toEqual([]);
    });

    it('prunes tracking for vanished casts', () => {
        const t = createAlertTracker();
        const r = [rule()];
        t.step(input(actors({ me: { [OVERTURE]: 130 } }), 100, r));
        t.step(input(actors({}), 101, r));
        expect(secs(t.step(input(actors({ me: { [OVERTURE]: 130 } }), 106, r)))).toEqual([]);
    });

    it('fillMessage', () => {
        const v = { sec: 15, name: 'A', cc: '序曲' };
        expect(fillMessage('序曲剩 {秒} 秒', v)).toBe('序曲剩 15 秒');
        expect(fillMessage('', v)).toBe('A 序曲 剩 15 秒');
    });

    it('fillMessage for periodic blanks {CC} and {秒} and has its own default', () => {
        const v = { sec: 0, name: 'A', cc: '序曲' };
        expect(fillMessage('', v, 'periodic')).toBe('A 條件成立');
        expect(fillMessage('{名字}[{CC}][{秒}]', v, 'periodic')).toBe('A[][]');
    });

    describe('condition groups', () => {
        const SECOND = 1002;
        const conds = [{ mode: 'absent' as const, ccId: SOUL }, { mode: 'present' as const, ccId: SECOND }];
        const run = (join: 'and' | 'or', soul: boolean, second: boolean) => {
            const t = createAlertTracker();
            const cc: Conds = { [OVERTURE]: 130 };
            if (soul) cc[SOUL] = 500;
            if (second) cc[SECOND] = 500;
            const a = actors({ me: cc });
            const r = [rule({ conds, join })];
            t.step(input(a, 100, r));
            return t.step(input(a, 106, r));
        };
        it('and needs every condition', () => {
            expect(secs(run('and', false, true))).toEqual([25]);
            expect(secs(run('and', true, true))).toEqual([]);
            expect(secs(run('and', false, false))).toEqual([]);
        });
        it('or needs one condition', () => {
            expect(secs(run('or', true, true))).toEqual([25]);
            expect(secs(run('or', false, false))).toEqual([25]);
            expect(secs(run('or', true, false))).toEqual([]);
        });
        it('red follows the group', () => {
            expect(run('and', false, false).red.size).toBe(0);
            expect(run('or', false, false).red.has(`me:${OVERTURE}`)).toBe(true);
        });
    });

    describe('periodic', () => {
        const periodic = (p: Partial<AlertRule> = {}) => rule({ kind: 'periodic', ccId: 0, times: [], every: 30, ...p });
        it('fires immediately, then every N seconds', () => {
            const t = createAlertTracker();
            const a = actors({ me: {} });
            const r = [periodic()];
            const n = (now: number) => t.step(input(a, now, r)).fires.length;
            expect([n(100), n(110), n(129), n(130), n(140), n(160)]).toEqual([1, 0, 0, 1, 0, 1]);
        });
        it('resets when the condition breaks, so it fires again at once', () => {
            const t = createAlertTracker();
            const r = [periodic({ conds: [{ mode: 'present', ccId: TUAN }] })];
            const on = actors({ me: { [TUAN]: 0 } });
            const off = actors({ me: {} });
            const n = (a: Record<string, EntityActor>, now: number) => t.step(input(a, now, r)).fires.length;
            expect([n(on, 100), n(on, 101), n(off, 102), n(on, 103)]).toEqual([1, 0, 0, 1]);
        });
        it('time going backwards resets', () => {
            const t = createAlertTracker();
            const a = actors({ me: {} });
            const r = [periodic()];
            expect(t.step(input(a, 100, r)).fires).toHaveLength(1);
            expect(t.step(input(a, 90, r)).fires).toHaveLength(1);
        });
        it('with no conditions holds always; sec is 0 and red stays empty', () => {
            const t = createAlertTracker();
            const s = t.step(input(actors({ me: {} }), 100, [periodic()]));
            expect(s.fires.map(f => [f.actorId, f.sec])).toEqual([['me', 0]]);
            expect(s.red.size).toBe(0);
        });
        it('ignores {CC} and {秒} and defaults to a condition sentence', () => {
            const t = createAlertTracker();
            const a = actors({ me: {} });
            expect(t.step(input(a, 100, [periodic()])).fires[0].text).toBe('name-me 條件成立');
            const t2 = createAlertTracker();
            expect(t2.step(input(a, 100, [periodic({ textMessage: '{名字}|{CC}|{秒}' })])).fires[0].text).toBe('name-me||');
        });
        it('tracks each actor separately', () => {
            const t = createAlertTracker();
            const a = actors({ me: {}, p1: {} });
            const r = [periodic({ target: 'all' })];
            const ip = { partyIds: ['me', 'p1'] };
            expect(t.step(input(a, 100, r, ip)).fires.map(f => f.actorId)).toEqual(['me', 'p1']);
            expect(t.step(input(a, 110, r, ip)).fires).toEqual([]);
        });
    });

    describe('messages', () => {
        it('voiceText falls back to the filled text sentence', () => {
            const t = createAlertTracker();
            const a = actors({ me: { [OVERTURE]: 130 } });
            const r = [rule({ textMessage: '{名字}:{秒}' })];
            t.step(input(a, 100, r));
            const f = t.step(input(a, 106, r)).fires[0];
            expect([f.text, f.voiceText]).toEqual(['name-me:25', 'name-me:25']);
        });
        it('voiceMessage is filled separately', () => {
            const t = createAlertTracker();
            const a = actors({ me: { [OVERTURE]: 130 } });
            const r = [rule({ textMessage: 'T', voiceMessage: '{CC} {秒}' })];
            t.step(input(a, 100, r));
            const f = t.step(input(a, 106, r)).fires[0];
            expect([f.text, f.voiceText]).toEqual(['T', 'cc-1001 25']);
        });
    });

    describe('dismissal inputs', () => {
        it('holding lists rule:actor whose condition group holds, even with no active cc', () => {
            const t = createAlertTracker();
            const r = [rule({ conds: [{ mode: 'absent', ccId: SOUL }] })];
            expect([...t.step(input(actors({ me: {} }), 100, r)).holding]).toEqual(['r1:me']);
            expect([...t.step(input(actors({ me: { [SOUL]: 500 } }), 101, r)).holding]).toEqual([]);
        });
        it('holding includes rules without conditions and skips disabled rules', () => {
            const t = createAlertTracker();
            const a = actors({ me: {} });
            expect([...t.step(input(a, 100, [rule()])).holding]).toEqual(['r1:me']);
            expect([...t.step(input(a, 101, [rule({ enabled: false })])).holding]).toEqual([]);
        });
        it('ccLive lists active casts by DisableAt', () => {
            const t = createAlertTracker();
            const r = [rule()];
            expect([...t.step(input(actors({ me: { [OVERTURE]: 130 } }), 100, r)).ccLive]).toEqual(['r1:me:130']);
            expect([...t.step(input(actors({ me: { [OVERTURE]: 200 } }), 101, r)).ccLive]).toEqual(['r1:me:200']);
            expect([...t.step(input(actors({ me: {} }), 102, r)).ccLive]).toEqual([]);
        });
        it('fires carry the cast key', () => {
            const t = createAlertTracker();
            const a = actors({ me: { [OVERTURE]: 130 } });
            t.step(input(a, 100, [rule()]));
            expect(t.step(input(a, 106, [rule()])).fires[0].castKey).toBe('r1:me:130');
        });
    });
});

describe('alertRules across a clock shift', () => {
    const shifted = (disableAt: number, shiftedBy: number) => ({
        me: { conditionMap: { [OVERTURE]: { DisableAt: disableAt, Shifted: shiftedBy } } },
    }) as unknown as Record<string, EntityActor>;

    it('a shift mid-countdown still fires the next threshold once', () => {
        const t = createAlertTracker();
        const r = [rule()];
        t.step(input(actors({ me: { [OVERTURE]: 130 } }), 100, r));
        expect(secs(t.step(input(actors({ me: { [OVERTURE]: 130 } }), 106, r)))).toEqual([25]);
        // 10s left becomes 6s left: the 15 threshold is crossed by the shift itself.
        expect(secs(t.step(input(shifted(126, -4), 120, r)))).toEqual([15]);
        expect(secs(t.step(input(shifted(126, -4), 121, r)))).toEqual([5]);
        expect(secs(t.step(input(shifted(126, -4), 122, r)))).toEqual([]);
    });

    it('keeps the cast key so a dismissed alert does not return', () => {
        const t = createAlertTracker();
        const r = [rule({ dismiss: { condFails: false, ccEnds: true, replaced: false } })];
        t.step(input(actors({ me: { [OVERTURE]: 130 } }), 100, r));
        const before = t.step(input(actors({ me: { [OVERTURE]: 130 } }), 106, r));
        const after = t.step(input(shifted(126, -4), 107, r));
        expect([...after.ccLive]).toEqual([...before.ccLive]);
        expect(before.fires[0].castKey).toBe([...before.ccLive][0]);
    });
});

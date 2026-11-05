import { describe, expect, it } from 'vitest';
import type { EntityActor } from '@/eventActor';
import type { eventBardsong, eventBardsongPulse } from '@/protocols';
import { createAlertTracker } from './alertRules';
import { defaultRules } from './overlaySettings';
import { warcryConditions, withConditions } from './warcryLive';

const pulse = (At: number, Targets: string[], Id = 'bard'): eventBardsongPulse =>
    ({ EventId: 25, At, Id, Targets, Stop: false }) as eventBardsongPulse;
const stop = (At: number, Id = 'bard'): eventBardsongPulse => ({ EventId: 25, At, Id, Targets: [], Stop: true }) as eventBardsongPulse;
const end = (At: number): eventBardsong => ({ EventId: 16, At, IsEnd: true }) as eventBardsong;
const until = (m: ReturnType<typeof warcryConditions>, id: string) => m.get(id)?.DisableAt;

describe('warcryConditions', () => {
    it('one pulse then a stop: 20 s for everyone listed', () => {
        const p = [pulse(100, ['me', 'b']), stop(101)];
        const m = warcryConditions(p, [], 'me', 105);
        expect([until(m, 'me'), until(m, 'b'), m.get('me')?.CCId]).toEqual([120, 120, 900206]);
        expect(warcryConditions(p, [], 'me', 120).size).toBe(0);
    });

    it('while the performer keeps singing, the next pulse is counted in', () => {
        const p = [pulse(100, ['me']), pulse(110, ['me'])];
        expect(until(warcryConditions(p, [], 'me', 115), 'me')).toBe(140);
        // No pulse for 12 s: the song stopped refreshing.
        expect(until(warcryConditions(p, [], 'me', 122), 'me')).toBe(130);
        // Left out of the latest pulse: out of range, no projection.
        const out = [...p, pulse(120, ['b'])];
        expect(until(warcryConditions(out, [], 'me', 121), 'me')).toBe(130);
    });

    it('the end notice closes the local player early', () => {
        const m = warcryConditions([pulse(100, ['me', 'b']), stop(101)], [end(105)], 'me', 104);
        expect(until(m, 'me')).toBe(120);
        const after = warcryConditions([pulse(100, ['me', 'b']), stop(101)], [end(105)], 'me', 106);
        expect([after.has('me'), until(after, 'b')]).toEqual([false, 120]);
    });

    it('withConditions adds the cc without touching the real actor', () => {
        const real = { me: { conditionMap: { 5: { DisableAt: 0 } } } as unknown as EntityActor };
        const v = withConditions(real, warcryConditions([pulse(100, ['me'])], [], 'me', 101));
        expect(Object.keys(v.me.conditionMap)).toEqual(['5', '900206']);
        expect(Object.keys(real.me.conditionMap)).toEqual(['5']);
    });

    it('a 戰吼 countdown rule at 10 s fires only once the song stops refreshing', () => {
        const rules = [{ ...defaultRules()[0], id: 'wc', enabled: true, kind: 'countdown' as const, target: 'self' as const, ccId: 900206, times: [10], conds: [] }];
        const t = createAlertTracker();
        const fired: number[] = [];
        const pulses = [pulse(100, ['me']), pulse(111, ['me']), pulse(122, ['me']), stop(123)];
        for (let now = 100; now <= 146; now += 0.25) {
            const seen = pulses.filter(p => p.At <= now);
            const actors = withConditions({ me: { conditionMap: {} } as unknown as EntityActor }, warcryConditions(seen, [], 'me', now));
            const s = t.step({
                now, actors, ownerId: 'me', partyIds: ['me'], bossId: '', rules, nameOf: id => id, ccNameOf: () => '戰吼',
            });
            if (s.fires.length) fired.push(now);
        }
        expect(fired).toEqual([132]);
    });
});

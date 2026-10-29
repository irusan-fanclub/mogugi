// @vitest-environment happy-dom
vi.mock('@/lib/runtimeEnv', async o => ({ ...(await o<object>()), isDesktop: () => true }));
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';

type Handler = (data: unknown) => void;
const bridge = vi.hoisted(() => ({
    handlers: new Map<string, Handler[]>(),
    emitted: [] as { name: string; data: unknown }[],
}));
vi.mock('@/lib/desktopBridge', () => ({
    onDesktopEvent: async (name: string, cb: Handler) => {
        const list = bridge.handlers.get(name) ?? [];
        list.push(cb);
        bridge.handlers.set(name, list);
        return () => { bridge.handlers.set(name, (bridge.handlers.get(name) ?? []).filter(h => h !== cb)); };
    },
    emitDesktop: async (name: string, data?: unknown) => { bridge.emitted.push({ name, data }); },
}));

import type { EntityDamage } from '@/eventActor';
import {
    actorManager, dcManager, clearTimeRange, setTimeRange, condNameMap, skillNameMap,
} from '@/store';
import { EV, type ChartData } from '@/lib/chartProtocol';
import { selectedTargetId } from '../tabs/battle/battleSelection';
import { startChartHub } from './chartHub';
import { chartHubId } from '@/lib/chartTransport';
import type { ConditionPayload } from './conditionPayload';
import type { HitLogPayload } from './hitlogPayload';

const fire = (name: string, data: unknown) => (bridge.handlers.get(name) ?? []).forEach(h => h(data));
const msgs = <P>(id?: string) => bridge.emitted
    .filter(e => e.name === EV.data && (!id || (e.data as ChartData).id === id))
    .map(e => e.data as ChartData<P>);
const hit = (At: number, Damage: number, over: Partial<EntityDamage> = {}) =>
    ({ Id: 'p1', TargetId: 't1', SkillId: 10, At, Damage, IsCritical: false, IsDelayed: false, PetId: '', Conditions: [], TargetConditions: [], ...over }) as unknown as EntityDamage;
const hello = (id: string, spec: object, opts: object = {}) => fire(EV.hello, { id, spec, opts });

const P1 = '4503599630022001';
const appear = (Id: string, RaceId: number, Name: string) =>
    ({ EventId: 1, At: 1, Id, RaceId, Name, Height: 1, Weight: 1, Upper: 1, Lower: 1, GuildName: '', OwnerId: '' });
const ccOn = (CCId: number, At: number, AttackerId = P1) =>
    ({ EventId: 4, At, Id: P1, CCId, DisableAt: 0, AttackerId, Params: {} });
const ccOff = (CCId: number, At: number) => ({ EventId: 5, At, Id: P1, CCId });
const feed = (...events: object[]) => events.forEach(e => actorManager.value.onEvent(e as never));

let stop: () => void;
beforeEach(async () => {
    vi.useFakeTimers();
    bridge.handlers.clear();
    bridge.emitted.length = 0;
    actorManager.value.clear();
    for (const k of Object.keys(actorManager.value.entityMap)) delete actorManager.value.entityMap[k];
    for (const k of Object.keys(actorManager.value.groupMap)) delete actorManager.value.groupMap[k];
    dcManager.value.clear();
    clearTimeRange();
    selectedTargetId.value = '';
    condNameMap.value = { 5: 'Five', 7: 'Seven', 9: 'Nine' };
    skillNameMap.value = { 10: 'Smash', 11: 'Slash' };
    stop = await startChartHub();
});
afterEach(() => { stop(); vi.useRealTimers(); });

describe('chart:unbind', () => {
    it('drops the instance unless this hub is the one to keep', () => {
        dcManager.value.onDamage(hit(100, 10));
        hello('d~1', { kind: 'hitlog', attackerId: 'p1', targetId: '', skillId: 10 });
        fire(EV.unbind, { id: 'd~1', keep: chartHubId });
        dcManager.value.onDamage(hit(101, 10));
        vi.advanceTimersByTime(500);
        expect(msgs('d~1')).toHaveLength(2); // still registered: hello + the new hit
        fire(EV.unbind, { id: 'd~1', keep: 'someone-else' });
        dcManager.value.onDamage(hit(102, 10));
        vi.advanceTimersByTime(1000);
        expect(msgs('d~1')).toHaveLength(2);
    });
});

describe('condition kind', () => {
    beforeEach(() => {
        feed(appear(P1, 10002, 'Hero'));
        feed(ccOn(5, 10), ccOn(7, 11), ccOff(5, 20), ccOff(7, 30));
    });
    it('lists options, honours opts.ccId and titles "{cc} - {player}"', () => {
        hello('c', { kind: 'condition', attackerId: P1 }, { ccId: 5 });
        const m = msgs<ConditionPayload>()[0];
        expect(m.payload.ccId).toBe(5);
        expect(m.payload.options.map(o => o.id)).toEqual([5, 7]);
        expect(m.payload.options[0]).toMatchObject({ name: 'Five', icon: '/icons/cc/5.png' });
        expect(m.payload.total).toBe(20);
        expect(m.payload.on).toBe(10);
        expect(m.title).toBe('Five - Hero');
        expect(m.payload.series[0].points[0]).toEqual([10000, 1]);
    });
    it('defaults to the first option', () => {
        hello('c', { kind: 'condition', attackerId: P1 }, {});
        const m = msgs<ConditionPayload>()[0];
        expect(m.payload.ccId).toBe(m.payload.options[0].id);
    });
    it('re-sends when eviction moves the seed start without changing length or last At', () => {
        const P2 = '4503599630022002';
        feed(appear(P2, 10002, 'Two'), { ...ccOn(5, 10), Id: P2 }, { ...ccOff(5, 20), Id: P2 });
        hello('c', { kind: 'condition', attackerId: P2 }, { ccId: 5 });
        const n = msgs<ConditionPayload>().length;
        const len = actorManager.value.entityMap[P2].conditionHistory.length;
        actorManager.value.evictBefore(15, [P1, P2]);
        expect(actorManager.value.entityMap[P2].conditionHistory).toHaveLength(len);
        vi.advanceTimersByTime(500);
        const all = msgs<ConditionPayload>();
        expect(all).toHaveLength(n + 1);
        expect(all.at(-1)!.payload.series[0].points[0]).toEqual([15000, 1]);
    });
    it('bounds the stats window to the target damage span when a target is selected', () => {
        dcManager.value.onDamage(hit(11, 1, { Id: P1 }));
        dcManager.value.onDamage(hit(25, 1, { Id: P1 }));
        selectedTargetId.value = 't1';
        hello('c', { kind: 'condition', attackerId: P1 }, { ccId: 5 });
        const p = msgs<ConditionPayload>()[0].payload;
        expect(p.total).toBe(14);
        expect(p.on).toBe(9);
    });
});

describe('hitlog kind', () => {
    const base = () => {
        dcManager.value.onDamage(hit(100, 1500, { Conditions: [{ CCId: 5 }, { CCId: 7 }] as never, TargetConditions: [{ CCId: 9 }] as never }));
        dcManager.value.onDamage(hit(110, 20, { IsCritical: true, IsDelayed: true, SkillId: 11 }));
        dcManager.value.onDamage(hit(120, 30, { TargetId: 't2' }));
    };
    it('skill spec lists that skill bucket with names, flags and cond lists', () => {
        base();
        hello('h', { kind: 'hitlog', attackerId: 'p1', targetId: '', skillId: 10 });
        const p = msgs<HitLogPayload>()[0].payload;
        expect(p.header).toBe('p1 -> Smash');
        expect(p.hits).toHaveLength(2);
        expect(p.hits[0]).toMatchObject({
            at: 100, skillIcon: '/icons/skill/10.png', skillName: 'Smash', crit: false, delayed: false,
            cond: [{ id: 5, name: 'Five' }, { id: 7, name: 'Seven' }], targetCond: [{ id: 9, name: 'Nine' }],
        });
        expect(p.hits[0].damage).toBe('1.50K');
    });
    it('the spec target filters the skill bucket', () => {
        base();
        hello('h', { kind: 'hitlog', attackerId: 'p1', targetId: 't2', skillId: 10 });
        expect(msgs<HitLogPayload>()[0].payload.hits.map(h => h.at)).toEqual([120]);
    });
    it('a skill hitlog ignores the time range (and sends no update when it changes)', () => {
        base();
        hello('h', { kind: 'hitlog', attackerId: 'p1', targetId: '', skillId: 10 });
        setTimeRange(100, 100);
        vi.advanceTimersByTime(1000);
        expect(msgs<HitLogPayload>()).toHaveLength(1);
        expect(msgs<HitLogPayload>()[0].payload.hits).toHaveLength(2);
    });
    it('the all-hits log uses the time-filtered damages and updates with the range', () => {
        base();
        hello('h', { kind: 'hitlog', attackerId: 'p1', targetId: '' });
        expect(msgs<HitLogPayload>()[0].payload.hits).toHaveLength(3);
        setTimeRange(105, 125);
        vi.advanceTimersByTime(500);
        expect(msgs<HitLogPayload>()[1].payload.hits.map(h => h.at)).toEqual([110, 120]);
        expect(msgs<HitLogPayload>()[1].payload.header).toBe('p1 -> All');
    });
    it('caps the hit list and says so in the header', () => {
        for (let i = 0; i < 5100; i++) dcManager.value.onDamage(hit(1000 + i, 1));
        hello('h', { kind: 'hitlog', attackerId: 'p1', targetId: '' });
        const p = msgs<HitLogPayload>()[0].payload;
        expect(p.hits).toHaveLength(5000);
        expect(p.hits.at(-1)!.at).toBe(1000 + 5099);
        expect(p.header).toContain('5100');
    });
});

describe('range', () => {
    it('does not re-send kinds that ignore it', async () => {
        dcManager.value.onDamage(hit(100, 1));
        hello('h', { kind: 'hitlog', attackerId: 'p1', targetId: '', skillId: 10 });
        setTimeRange(1, 2);
        await nextTick();
        vi.advanceTimersByTime(1000);
        expect(msgs()).toHaveLength(1);
    });
});

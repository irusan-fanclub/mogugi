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
import { dcManager, timeRangeMin, timeRangeMax, clearTimeRange, setTimeRange } from '@/store';
import { EV, type ChartData } from '@/lib/chartProtocol';
import { selectedTargetId } from '../tabs/battle/battleSelection';
import { startChartHub } from './chartHub';
import type { HitLogPayload } from './hitlogPayload';

const fire = (name: string, data: unknown) => (bridge.handlers.get(name) ?? []).forEach(h => h(data));
const dataMsgs = (id?: string) => bridge.emitted
    .filter(e => e.name === EV.data && (!id || (e.data as ChartData).id === id))
    .map(e => e.data as ChartData<HitLogPayload>);
let seq = 0;
const hit = (At: number, Damage: number, over: Partial<EntityDamage> = {}) =>
    ({ Id: 'p1', TargetId: 't1', SkillId: 10, At, Damage, IsCritical: false, IsDelayed: false, PetId: '', Conditions: [], TargetConditions: [], ...over }) as unknown as EntityDamage;
const ALL = { kind: 'hitlog', attackerId: 'p1', targetId: '' };
const hello = (id: string, spec: object, opts: object = {}) => fire(EV.hello, { id, spec, opts });

let stop: () => void;
beforeEach(async () => {
    vi.useFakeTimers();
    bridge.handlers.clear();
    bridge.emitted.length = 0;
    dcManager.value.clear();
    clearTimeRange();
    selectedTargetId.value = '';
    seq++;
    stop = await startChartHub();
});
afterEach(() => { stop(); vi.useRealTimers(); });

describe('chartHub', () => {
    it('broadcasts main-ready once at start', () => {
        expect(bridge.emitted.filter(e => e.name === EV.mainReady)).toHaveLength(1);
    });

    it('hello computes and emits data immediately', () => {
        dcManager.value.onDamage(hit(100, 10));
        dcManager.value.onDamage(hit(120, 5));
        hello(`w${seq}`, ALL);
        const msgs = dataMsgs();
        expect(msgs).toHaveLength(1);
        expect(msgs[0].id).toBe(`w${seq}`);
        expect(msgs[0].payload.hits).toHaveLength(2);
        expect(msgs[0].title).toBe('p1 -> All');
    });

    it('does not re-emit when nothing changed, and emits once after a new hit', () => {
        dcManager.value.onDamage(hit(100, 10));
        hello('a', ALL);
        vi.advanceTimersByTime(1500);
        expect(dataMsgs()).toHaveLength(1);
        dcManager.value.onDamage(hit(101, 10));
        vi.advanceTimersByTime(500);
        expect(dataMsgs()).toHaveLength(2);
        vi.advanceTimersByTime(1500);
        expect(dataMsgs()).toHaveLength(2);
    });

    it('skill specs use the skill damages and the skill name', () => {
        dcManager.value.onDamage(hit(100, 10, { SkillId: 10 }));
        dcManager.value.onDamage(hit(101, 99, { SkillId: 11 }));
        hello('a', { kind: 'hitlog', attackerId: 'p1', targetId: '', skillId: 10 });
        const m = dataMsgs()[0];
        expect(m.payload.hits).toHaveLength(1);
        expect(m.title).toBe('p1 -> unknownSkill:10');
    });

    it('stops sending after window:closed', () => {
        dcManager.value.onDamage(hit(100, 10));
        hello('a', ALL);
        fire(EV.closed, { id: 'a' });
        dcManager.value.onDamage(hit(101, 10));
        vi.advanceTimersByTime(2000);
        expect(dataMsgs()).toHaveLength(1);
    });

    it('a reused browser tab (closed, then hello) re-registers and gets data', () => {
        dcManager.value.onDamage(hit(100, 10));
        hello('a', ALL);
        fire(EV.closed, { id: 'a' });
        hello('a', ALL);
        expect(dataMsgs()).toHaveLength(2);
        dcManager.value.onDamage(hit(101, 10));
        vi.advanceTimersByTime(500);
        expect(dataMsgs()).toHaveLength(3);
    });

    it('ignores malformed hello and unknown kinds without throwing', () => {
        fire(EV.hello, null);
        fire(EV.hello, { id: 'x' });
        hello('x', { kind: 'nope' });
        expect(dataMsgs()).toHaveLength(0);
    });

    it('ignores removed chart specs from old saved windows', () => {
        dcManager.value.onDamage(hit(100, 10));
        hello('old1', { kind: 'cumulative', attackerId: 'p1' });
        hello('old2', { kind: 'dps', attackerId: 'p1', skillId: 10 });
        hello('old3', { kind: 'count', attackerId: 'p1' });
        hello('old4', { kind: 'distribution', attackerId: 'p1', skillId: 10 });
        vi.advanceTimersByTime(1500);
        expect(dataMsgs()).toHaveLength(0);
        fire(EV.closed, { id: 'old1' });
        fire(EV.closed, { id: 'old2' });
        fire(EV.closed, { id: 'old3' });
        fire(EV.closed, { id: 'old4' });
    });

    it('applies chart:range to the global time range', () => {
        fire(EV.range, { min: 10, max: 20 });
        expect([timeRangeMin.value, timeRangeMax.value]).toEqual([10, 20]);
        fire(EV.range, null);
        expect([timeRangeMin.value, timeRangeMax.value]).toEqual([null, null]);
    });

    it('stop removes listeners and the timer', () => {
        dcManager.value.onDamage(hit(100, 10));
        hello('a', ALL);
        stop();
        dcManager.value.onDamage(hit(101, 10));
        vi.advanceTimersByTime(2000);
        expect(dataMsgs()).toHaveLength(1);
        expect(bridge.handlers.get(EV.hello)).toHaveLength(0);
    });

    it('broadcasts the store time range to charts, null when cleared', async () => {
        const sync = () => bridge.emitted.filter(e => e.name === EV.rangeSync).map(e => e.data);
        setTimeRange(10, 20);
        await nextTick();
        clearTimeRange();
        await nextTick();
        expect(sync()).toEqual([{ min: 10, max: 20 }, null]);
    });

    it('setTimeRange emits one atomic message, never a transient null', async () => {
        const sync = () => bridge.emitted.filter(e => e.name === EV.rangeSync).map(e => e.data);
        setTimeRange(10, 20);
        await nextTick();
        expect(sync()).toEqual([{ min: 10, max: 20 }]);
        setTimeRange(30, 40);
        await nextTick();
        expect(sync()).toEqual([{ min: 10, max: 20 }, { min: 30, max: 40 }]);
    });

    it('a hello answered while a range is set also sends that range', () => {
        setTimeRange(10, 20);
        bridge.emitted.length = 0;
        dcManager.value.onDamage(hit(100, 10));
        hello('late', ALL);
        expect(bridge.emitted.map(e => e.name)).toContain(EV.data);
        expect(bridge.emitted.filter(e => e.name === EV.rangeSync).map(e => e.data)).toEqual([{ min: 10, max: 20 }]);
    });

    it('a hello with no range sends null so a stale chart range clears', () => {
        hello('late', ALL);
        expect(bridge.emitted.filter(e => e.name === EV.rangeSync).map(e => e.data)).toEqual([null]);
    });

    it('re-emits after an in-place change with the same length and last hit (reattribute)', () => {
        dcManager.value.onDamage(hit(100, 10, { Id: 'x' }));
        dcManager.value.onDamage(hit(101, 5));
        dcManager.value.onDamage(hit(102, 7));
        hello('a', ALL);
        expect(dataMsgs()[0].payload.hits).toHaveLength(2);
        dcManager.value.reattribute('x', 'p1');
        vi.advanceTimersByTime(500);
        expect(dataMsgs()).toHaveLength(2);
        expect(dataMsgs()[1].payload.hits).toHaveLength(3);
    });
});

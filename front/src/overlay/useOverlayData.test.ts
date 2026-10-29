// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { defineComponent, h, nextTick, ref, watch } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';

type Handler = (data: unknown) => void;
const bridge = vi.hoisted(() => ({ handlers: new Map<string, Handler[]>(), emitted: [] as { name: string; data: unknown }[] }));
vi.mock('@/lib/desktopBridge', () => ({
    onDesktopEvent: async (name: string, cb: Handler) => {
        bridge.handlers.set(name, [...(bridge.handlers.get(name) ?? []), cb]);
        return () => {};
    },
    emitDesktop: async (name: string, data?: unknown) => { bridge.emitted.push({ name, data }); },
}));
const sessionMock = vi.hoisted(() => ({ created: 0, close: vi.fn(), opts: null as { url: string; onBattleBoundary?: (at: number, present?: string[]) => void } | null }));
vi.mock('@/lib/backendSession', () => ({
    createBackendSession: (o: { url: string; onBattleBoundary?: (at: number, present?: string[]) => void }) => {
        sessionMock.opts = o;
        sessionMock.created++;
        return { source: ref(null), connect: vi.fn(), close: sessionMock.close };
    },
}));
vi.mock('@/lib/gameData', () => ({ loadNameMaps: async () => {} }));
vi.mock('@/lib/iconFallback', () => ({ installIconFallback: () => () => {} }));

import { actorManager, dcManager } from '@/store';
import { applyAlerts, useOverlayData, type AlertItem, type OverlayData } from './useOverlayData';
import type { AlertFire } from '@/lib/alertRules';
import type { AlertRule } from '@/lib/overlaySettings';
import { appear, hit, cc, BOSS_RACE } from './testSupport';
import { overlayWants } from '@/lib/overlayEvents';
import type { eventBase } from '@/protocols';

const speechMock = vi.hoisted(() => ({ say: vi.fn(), cancel: vi.fn() }));
vi.mock('./speechQueue', () => ({ createSpeechQueue: () => speechMock }));

const fire = (name: string, data: unknown) => (bridge.handlers.get(name) ?? []).forEach(h => h(data));
let w: VueWrapper | null = null;
let data: OverlayData;

async function mountHook() {
    w = mount(defineComponent({ setup() { data = useOverlayData(); return () => h('div'); } }));
    await flushPromises();
}
const tick = async (ms = 500) => { await vi.advanceTimersByTimeAsync(ms); await nextTick(); };

beforeEach(() => {
    vi.useFakeTimers();
    bridge.handlers.clear();
    bridge.emitted.length = 0;
    sessionMock.created = 0;
    speechMock.say.mockClear();
    actorManager.value.clear();
    dcManager.value.clear();
});
afterEach(() => { w?.unmount(); w = null; vi.useRealTimers(); });

describe('useOverlayData', () => {
    it('closes its socket on unmount', async () => {
        await mountHook();
        sessionMock.close.mockClear();
        w!.unmount();
        w = null;
        expect(sessionMock.close).toHaveBeenCalledTimes(1);
    });

    it('subscribes to the current battle, overlay scope', async () => {
        await mountHook();
        expect(sessionMock.opts!.url).toMatch(/\?history=current&scope=overlay$/);
    });

    it('drops the previous battle on a boundary', async () => {
        await mountHook();
        appear('p1', 8001, 100, 'Alice');
        appear('b1', BOSS_RACE, 100);
        hit('p1', 'b1', 1000, 100);
        hit('p1', 'b1', 2000, 40);
        await tick();
        expect(data.dps.value.rows.map(r => r.total)).toEqual([140]);
        sessionMock.opts!.onBattleBoundary!(1500);
        await tick();
        expect(data.dps.value.rows.map(r => r.total)).toEqual([40]);
    });

    it('a boundary keeps a quiet present entity and drops one that is gone', async () => {
        await mountHook();
        appear('p1', 8001, 100, 'Alice');
        appear('p2', 8001, 100, 'Bob');
        hit('p2', 'p1', 1, 100);
        await tick();
        sessionMock.opts!.onBattleBoundary!(1500, ['p1']);
        expect(actorManager.value.entityMap['p1']).toBeDefined();
        expect(actorManager.value.entityMap['p2']).toBeUndefined();
    });

    it('shows the same view models from the filtered stream as from the full one', async () => {
        const e = (o: object) => o as unknown as eventBase;
        const noise = [
            { EventId: 7, At: 100, Id: 'p1', PocketType: 1, ItemId: 1, Color1: '#0', Color2: '#0', Color3: '#0' },
            { EventId: 10, At: 100, Id: 'p1' }, { EventId: 11, At: 100, Id: 'p1' },
            { EventId: 16, At: 100, Id: 'p1' }, { EventId: 24, At: 100, Id: 'p1' },
        ];
        const soon = 2_000_000_100;
        const stream = [
            { EventId: 14, At: 100, Id: 'p1', Name: 'Alice' },
            { EventId: 1, At: 100, Id: 'p1', Name: 'Alice', RaceId: 8001, Height: 1, Weight: 1, Upper: 1, Lower: 1, GuildName: '', OwnerId: '' },
            { EventId: 1, At: 100, Id: 'p2', Name: 'Bob', RaceId: 8001, Height: 1, Weight: 1, Upper: 1, Lower: 1, GuildName: '', OwnerId: '' },
            { EventId: 1, At: 100, Id: 'b1', Name: 'Boss', RaceId: BOSS_RACE, Height: 1, Weight: 1, Upper: 1, Lower: 1, GuildName: '', OwnerId: '' },
            ...noise,
            { EventId: 20, At: 101, Id: 'b1', MaxLife: 1000 },
            { EventId: 3, At: 1000, Id: 'p1', TargetId: 'b1', SkillId: 10, Damage: 100, IsCritical: false, IsDelayed: false },
            { EventId: 3, At: 1001, Id: 'p2', TargetId: 'b1', SkillId: 10, Damage: 60, IsCritical: false, IsDelayed: false },
            { EventId: 4, At: 1000, Id: 'p2', CCId: 516, DisableAt: soon, AttackerId: '', Params: {} },
            { EventId: 4, At: 1000, Id: 'p1', CCId: 803, DisableAt: 0, AttackerId: 'p1', Params: {} },
            { EventId: 26, At: 1002, Id: 'b1', Life: 700 },
            { EventId: 17, At: 1003, Id: 'p1', SkillId: 10 },
        ];
        const run = async (list: object[]) => {
            vi.setSystemTime(2_000_000_000_000);
            actorManager.value.clear();
            dcManager.value.clear();
            await mountHook();
            list.forEach(x => actorManager.value.onEvent(e(x)));
            await tick();
            const out = JSON.parse(JSON.stringify({ dps: data.dps.value }));
            w!.unmount(); w = null;
            await mountHook();
            list.forEach(x => actorManager.value.onEvent(e(x)));
            await tick(250);
            out.cc = JSON.parse(JSON.stringify(data.cc.value));
            return out;
        };
        const full = await run(stream);
        const filtered = await run(stream.filter(overlayWants));
        expect(full.dps.rows.length).toBe(2);
        expect(filtered).toEqual(full);
    });

    it('emits hello then get-state after registering listeners', async () => {
        await mountHook();
        expect(bridge.emitted.map(e => e.name)).toEqual(['overlay:hello', 'overlay:get-state']);
                expect(['overlay:settings', 'overlay:target', 'overlay:state'].every(n => bridge.handlers.has(n))).toBe(true);
    });

    it('normalizes an overlay:settings payload', async () => {
        await mountHook();
        fire('overlay:settings', { dps: { opacity: 500, fontSize: 'l' } });
        expect(data.settings.value.dps.opacity).toBe(100);
        expect(data.settings.value.dps.fontSize).toBe('l');
        expect(data.settings.value.cc.opacity).toBe(0);
    });

    it('ignores a non-OverlayState overlay:state', async () => {
        await mountHook();
        fire('overlay:state', { locked: 'yes' });
        expect(data.state.value).toBeNull();
        const s = { locked: false, hotkey: 'Ctrl+Alt+L', hotkeyError: '', licensed: true, elevated: true, elevateError: '', hidden: false, visibleHotkey: 'Ctrl+Alt+O', visibleHotkeyError: '', layout: {}, gameFound: true };
        fire('overlay:state', s);
        expect(data.state.value).toEqual(s);
    });

    describe('targets', () => {
        async function setup() {
            await mountHook();
            appear('p1', 8001, 100, 'Alice');
            appear('b1', BOSS_RACE, 100);
            appear('b2', BOSS_RACE, 200);
            appear('m1', 1, 100);
            hit('p1', 'b1', 1000, 100);
            hit('p1', 'b1', 1010, 100);
            hit('p1', 'm1', 1020, 300);
        }

        it('falls back to latest boss without announcement', async () => {
            await setup();
            hit('p1', 'b2', 1030, 50);
            await tick();
            expect(data.dps.value.rows.map(r => r.total)).toEqual([50]);
            expect(data.dps.value.boss?.name).toBeTruthy();
        });

        it('uses all targets after overlay:target with an empty id', async () => {
            await setup();
            fire('overlay:target', { targetId: '' });
            await tick();
            expect(data.dps.value.rows.map(r => r.total)).toEqual([500]);
            fire('overlay:target', { targetId: 'b1' });
            await tick();
            expect(data.dps.value.rows.map(r => r.total)).toEqual([200]);
        });
    });

    describe('cc overlay', () => {
        it('lists teammates who have damage', async () => {
            await mountHook();
            appear('p1', 8001, 100, 'Alice');
            appear('p2', 8001, 100, 'Bob');
            appear('b1', BOSS_RACE, 100);
            hit('p1', 'b1', 1000, 100);
            hit('p2', 'b1', 1001, 100);
            cc('p2', 516, 1000, Date.now() / 1000 + 100);
            await tick(250);
            expect(data.cc.value.party.map(r => r.id)).toEqual(['p2']);
        });

        it('forgets attackers after the session is cleared', async () => {
            await mountHook();
            appear('p2', 8001, 100, 'Bob');
            appear('b1', BOSS_RACE, 100);
            hit('p2', 'b1', 1001, 100);
            cc('p2', 516, 1000, Date.now() / 1000 + 100);
            await tick(250);
            expect(data.cc.value.party.length).toBe(1);
            actorManager.value.clear();
            await tick(250);
            expect(data.cc.value.party).toEqual([]);
        });

        it('does not replace the view model when nothing changed', async () => {
            await mountHook();
            appear('b1', BOSS_RACE, 100);
            let n = 0;
            watch(() => data.cc.value, () => { n++; });
            await tick(250);
            const after = n;
            await tick(250);
            await tick(250);
            expect(n).toBe(after);
        });
    });

    it('dps view model is not replaced when nothing changed', async () => {
        await mountHook();
        appear('p1', 8001, 100, 'Alice');
        appear('b1', BOSS_RACE, 100);
        hit('p1', 'b1', 1000, 100);
        await tick();
        let n = 0;
        watch(() => data.dps.value, () => { n++; });
        await tick();
        await tick();
        expect(n).toBe(0);
    });

    it('opens one session for all four components', async () => {
        await mountHook();
        expect(sessionMock.created).toBe(1);
    });

    describe('alerts and cooldown', () => {
        const settingsWith = (voice: object = {}) => ({
            rules: [{
                id: 'r1', enabled: true, kind: 'countdown', target: 'self', ccId: 680, times: [25], every: 30,
                conds: [], join: 'and', text: true, textMessage: '{CC} {秒}', voice: true, voiceMessage: '', textKeep: 5,
                dismiss: { condFails: false, ccEnds: false, replaced: false },
            }],
            voice,
        });

        async function prelude(voice: object = {}) {
            vi.setSystemTime(2_000_000_000_000);
            await mountHook();
            appear('me', 8001, 100, 'Me');
            actorManager.value.onEvent({ EventId: 14, At: 100, Id: 'me', Name: 'Me' } as unknown as eventBase);
            fire('overlay:settings', settingsWith(voice));
            cc('me', 680, 1000, Date.now() / 1000 + 26);
            await tick(250);
            expect(data.alerts.value).toEqual([]);
        }

        it('adds an alert when the countdown crosses 25 s, speaks it, and expires it after 5 s', async () => {
            await prelude();
            await tick(1000);
            expect(data.alerts.value.map(a => a.text)).toEqual([expect.stringContaining('25')]);
            expect(speechMock.say).toHaveBeenCalledTimes(1);
            await tick(5000);
            expect(data.alerts.value).toEqual([]);
        });

        it('keeps a text alert for the rule textKeep seconds', async () => {
            await prelude();
            fire('overlay:settings', { rules: [{ ...settingsWith().rules[0], textKeep: 12 }] });
            await tick(1000);
            expect(data.alerts.value).toHaveLength(1);
            await tick(10000);
            expect(data.alerts.value).toHaveLength(1);
            await tick(2000);
            expect(data.alerts.value).toEqual([]);
        });

        it('speaks the voice message while showing the text message', async () => {
            await prelude();
            fire('overlay:settings', { rules: [{ ...settingsWith().rules[0], textMessage: 'T', voiceMessage: 'V{秒}' }] });
            await tick(1000);
            expect(data.alerts.value.map(a => a.text)).toEqual(['T']);
            expect(speechMock.say.mock.calls[0][0]).toBe('V25');
        });

        it('muted does not speak but still shows text', async () => {
            await prelude({ muted: true });
            await tick(1000);
            expect(data.alerts.value).toHaveLength(1);
            expect(speechMock.say).not.toHaveBeenCalled();
        });

        it('the alerts component switched off stops both text and voice', async () => {
            await prelude();
            fire('overlay:state', {
                locked: true, hotkey: 'Ctrl+Alt+L', hotkeyError: '', licensed: true, elevated: true, elevateError: '',
                hidden: false, visibleHotkey: 'Ctrl+Alt+O', visibleHotkeyError: '', gameFound: true,
                layout: { alerts: { enabled: false, anchor: 'center', x: 0, y: -170, width: 320, maxRows: 4 } },
            });
            await tick(1000);
            expect(data.alerts.value).toEqual([]);
            expect(speechMock.say).not.toHaveBeenCalled();
        });

        it('a rule with text off adds no alert but still speaks', async () => {
            await prelude();
            fire('overlay:settings', { rules: [{ ...settingsWith().rules[0], text: false }] });
            await tick(1000);
            expect(data.alerts.value).toEqual([]);
            expect(speechMock.say).toHaveBeenCalledTimes(1);
        });

        it('a time jump over several thresholds keeps only the lowest sec', async () => {
            vi.setSystemTime(2_000_000_000_000);
            await mountHook();
            appear('me', 8001, 100, 'Me');
            actorManager.value.onEvent({ EventId: 14, At: 100, Id: 'me', Name: 'Me' } as unknown as eventBase);
            fire('overlay:settings', { rules: [{ ...settingsWith().rules[0], times: [25, 10, 5] }] });
            cc('me', 680, 1000, Date.now() / 1000 + 30);
            await tick(250);
            vi.setSystemTime(Date.now() + 26_000);
            await tick(250);
            expect(data.alerts.value).toHaveLength(1);
            expect(data.alerts.value[0].text).toContain('5');
            expect(speechMock.say).toHaveBeenCalledTimes(1);
        });

        it('the cc icon of a rule in its alert window is red', async () => {
            await prelude();
            await tick(1000);
            fire('overlay:settings', { cc: { sections: { boss: [], self: [680], party: [] } }, ...settingsWith() });
            await tick(250);
            expect(data.cc.value.self!.icons[0].expiring).toBe(true);
        });

        it('lists cooldown rows with the owner marked', async () => {
            vi.setSystemTime(2_000_000_000_000);
            await mountHook();
            appear('me', 8001, 100, 'Me');
            appear('b1', BOSS_RACE, 100);
            actorManager.value.onEvent({ EventId: 14, At: 100, Id: 'me', Name: 'Me' } as unknown as eventBase);
            const now = Date.now() / 1000;
            actorManager.value.onEvent({
                EventId: 4, At: now - 100, Id: 'b1', CCId: 803, DisableAt: now - 40, AttackerId: 'me', Params: {},
            } as unknown as eventBase);
            await tick(250);
            expect(data.cooldown.value.map(r => [r.id, r.isSelf])).toEqual([['me', true]]);
        });
    });
});

describe('applyAlerts', () => {
    const base: AlertRule = {
        id: 'r1', enabled: true, kind: 'countdown', target: 'self', ccId: 680, times: [25], every: 30,
        conds: [{ mode: 'absent', ccId: 1 }], join: 'and', text: true, textMessage: '', voice: false, voiceMessage: '', textKeep: 5,
        dismiss: { condFails: false, ccEnds: false, replaced: false },
    };
    const item = (key: number, p: Partial<AlertItem> = {}): AlertItem => ({
        key, text: `t${key}`, at: 1000, ruleId: 'r1', actorId: 'me', castKey: 'r1:me:130', expireAt: 6000, ...p,
    });
    const fireOf = (p: Partial<AlertFire> = {}): AlertFire => ({
        ruleId: 'r1', actorId: 'me', sec: 25, text: 'new', voiceText: 'new', voice: false, showText: true, castKey: 'r1:me:130', ...p,
    });
    const live = { holding: new Set(['r1:me']), ccLive: new Set(['r1:me:130']) };
    const run = (items: AlertItem[], o: { rules?: AlertRule[]; step?: typeof live; now?: number; fires?: AlertFire[] } = {}) => {
        let k = 100;
        return applyAlerts({
            items, fires: o.fires ?? [], rules: o.rules ?? [base], step: o.step ?? live, nowMs: o.now ?? 2000, nextKey: () => ++k,
        });
    };
    const keys = (xs: AlertItem[]) => xs.map(x => x.key);

    it('returns the same array when nothing changed', () => {
        const items = [item(1)];
        expect(run(items)).toBe(items);
    });

    it('adds a fired alert that lives textKeep seconds', () => {
        const out = run([], { rules: [{ ...base, textKeep: 8 }], fires: [fireOf()] });
        expect(out).toEqual([{ key: 101, text: 'new', at: 2000, ruleId: 'r1', actorId: 'me', castKey: 'r1:me:130', expireAt: 10000 }]);
    });

    it('skips fires whose text is off', () => {
        expect(run([], { fires: [fireOf({ showText: false })] })).toEqual([]);
    });

    it('removes an alert once its time is up', () => {
        const items = [item(1, { expireAt: 2000 }), item(2, { expireAt: 2001 })];
        expect(keys(run(items, { now: 2000 }))).toEqual([2]);
    });

    it('condFails removes an alert when the group no longer holds', () => {
        const rules = [{ ...base, dismiss: { ...base.dismiss, condFails: true } }];
        const gone = { holding: new Set<string>(), ccLive: live.ccLive };
        expect(run([item(1)], { rules, step: gone })).toEqual([]);
        expect(keys(run([item(1)], { rules, step: live }))).toEqual([1]);
    });

    it('condFails without conditions never dismisses', () => {
        const rules = [{ ...base, conds: [], dismiss: { ...base.dismiss, condFails: true } }];
        const gone = { holding: new Set<string>(), ccLive: live.ccLive };
        expect(keys(run([item(1)], { rules, step: gone }))).toEqual([1]);
    });

    it('without the flag a failing condition keeps the alert', () => {
        const gone = { holding: new Set<string>(), ccLive: live.ccLive };
        expect(keys(run([item(1)], { step: gone }))).toEqual([1]);
    });

    it('ccEnds removes an alert when its cast is gone or replaced by a new one', () => {
        const rules = [{ ...base, dismiss: { ...base.dismiss, ccEnds: true } }];
        expect(run([item(1)], { rules, step: { holding: live.holding, ccLive: new Set() } })).toEqual([]);
        expect(run([item(1)], { rules, step: { holding: live.holding, ccLive: new Set(['r1:me:200']) } })).toEqual([]);
        expect(keys(run([item(1)], { rules }))).toEqual([1]);
    });

    it('ccEnds is ignored for a periodic rule', () => {
        const rules = [{ ...base, kind: 'periodic' as const, dismiss: { ...base.dismiss, ccEnds: true } }];
        const none = { holding: live.holding, ccLive: new Set<string>() };
        expect(keys(run([item(1, { castKey: '' })], { rules, step: none }))).toEqual([1]);
    });

    it('replaced removes older alerts of the same rule and actor only', () => {
        const rules = [{ ...base, dismiss: { ...base.dismiss, replaced: true } }];
        const items = [item(1), item(2, { actorId: 'p1' }), item(3, { ruleId: 'r2' })];
        const out = run(items, { rules: [...rules, { ...base, id: 'r2' }], fires: [fireOf()] });
        expect(keys(out)).toEqual([2, 3, 101]);
    });

    it('without replaced both alerts stay', () => {
        expect(keys(run([item(1)], { fires: [fireOf()] }))).toEqual([1, 101]);
    });

    it('an alert for a deleted rule lives out its time', () => {
        expect(keys(run([item(1)], { rules: [] }))).toEqual([1]);
    });
});

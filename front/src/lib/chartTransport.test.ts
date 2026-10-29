// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const env = vi.hoisted(() => ({ desktop: false }));
vi.mock('./runtimeEnv', () => ({ isDesktop: () => env.desktop }));
const bridge = vi.hoisted(() => ({
    emitDesktop: vi.fn(async () => {}),
    onDesktopEvent: vi.fn(async () => () => {}),
}));
vi.mock('./desktopBridge', () => bridge);

import { chartEmit, chartOn } from './chartTransport';
import { EV } from './chartProtocol';
import { reactive } from 'vue';

const tick = () => new Promise(r => setTimeout(r, 20));

beforeEach(() => { env.desktop = false; vi.clearAllMocks(); });
afterEach(() => { history.replaceState(null, '', '/'); });

describe('chartTransport in the browser', () => {
    it('chartOn receives a message another channel posts', async () => {
        const cb = vi.fn();
        await chartOn('x', cb);
        const other = new BroadcastChannel('mogugi-chart');
        other.postMessage({ name: 'x', data: 1 });
        other.postMessage({ name: 'y', data: 2 });
        await tick();
        other.close();
        expect(cb).toHaveBeenCalledTimes(1);
        expect(cb).toHaveBeenCalledWith(1);
    });

    it('chartEmit posts {name, data} on the shared channel', async () => {
        const other = new BroadcastChannel('mogugi-chart');
        const got: unknown[] = [];
        other.onmessage = e => got.push(e.data);
        chartEmit('x', { a: 1 });
        await tick();
        other.close();
        expect(got).toEqual([{ name: 'x', data: { a: 1 } }]);
        expect(bridge.emitDesktop).not.toHaveBeenCalled();
    });

    it('chart-to-hub payloads are plain data, so a Vue reactive object can be posted', async () => {
        const other = new BroadcastChannel('mogugi-chart');
        const got: { data?: unknown }[] = [];
        other.onmessage = e => got.push(e.data);
        chartEmit(EV.hello, { id: 'x', opts: reactive({ tick: '5min', nested: { a: 1 } }) });
        await tick();
        other.close();
        expect(() => structuredClone(got[0])).not.toThrow();
        expect(got[0].data).toEqual({ id: 'x', opts: { tick: '5min', nested: { a: 1 } } });
    });

    it('the unsubscribe function stops delivery', async () => {
        const cb = vi.fn();
        const off = await chartOn('x', cb);
        off?.();
        const other = new BroadcastChannel('mogugi-chart');
        other.postMessage({ name: 'x', data: 1 });
        await tick();
        other.close();
        expect(cb).not.toHaveBeenCalled();
    });
});

describe('chartTransport on desktop', () => {
    it('goes through the Wails bridge', async () => {
        env.desktop = true;
        chartEmit('x', 5);
        await chartOn('x', () => {});
        expect(bridge.emitDesktop).toHaveBeenCalledWith('x', 5);
        expect(bridge.onDesktopEvent).toHaveBeenCalledWith('x', expect.any(Function));
    });
});

describe('chartTransport hub binding in the browser', () => {
    // Fresh module state per case: the bound hub is module-level.
    const fresh = async () => { vi.resetModules(); return import('./chartTransport'); };

    it('a chart tab binds to the first hub that answers and ignores another', async () => {
        const t = await fresh();
        const cb = vi.fn();
        await t.chartOn(EV.data, cb);
        const hubs = new BroadcastChannel('mogugi-chart');
        hubs.postMessage({ name: EV.data, data: 'a1', hub: 'A' });
        hubs.postMessage({ name: EV.data, data: 'b1', hub: 'B' });
        hubs.postMessage({ name: EV.data, data: 'a2', hub: 'A' });
        await tick();
        hubs.close();
        expect(cb.mock.calls.map(c => c[0])).toEqual(['a1', 'a2']);
    });

    it('a bound chart addresses its messages to that hub and hubs ignore other addresses', async () => {
        const t = await fresh();
        await t.chartOn(EV.data, () => {});
        const peer = new BroadcastChannel('mogugi-chart');
        const got: unknown[] = [];
        peer.onmessage = e => got.push(e.data);
        peer.postMessage({ name: EV.data, data: 1, hub: 'A' });
        await tick();
        t.chartEmit(EV.hello, { id: 'c' });
        await tick();
        expect(got.at(-1)).toMatchObject({ name: EV.hello, to: 'A' });

        // As a hub: addressed to someone else is dropped, unaddressed or to us is kept.
        const hello = vi.fn();
        await t.chartOn(EV.hello, hello);
        peer.postMessage({ name: EV.hello, data: 'other', to: 'zzz' });
        peer.postMessage({ name: EV.hello, data: 'open' });
        await tick();
        peer.close();
        expect(hello.mock.calls.map(c => c[0])).toEqual(['open']);
    });

    it('hub-bound emits are stamped with a hub id', async () => {
        const t = await fresh();
        const peer = new BroadcastChannel('mogugi-chart');
        const got: { hub?: string }[] = [];
        peer.onmessage = e => got.push(e.data);
        t.chartEmit(EV.data, 1);
        await tick();
        peer.close();
        expect(typeof got[0].hub).toBe('string');
    });

    const asChartPage = async (id: string, hub?: string) => {
        history.replaceState(null, '', `/chart.html?id=${id}&spec=%7B%7D${hub ? `&hub=${hub}` : ''}`);
        return fresh();
    };

    it('a chart opened with ?hub= starts bound to that hub', async () => {
        const t = await asChartPage('X', 'A');
        const cb = vi.fn();
        await t.chartOn(EV.data, cb);
        const peer = new BroadcastChannel('mogugi-chart');
        peer.postMessage({ name: EV.data, data: { id: t.chartInstanceId, n: 1 }, hub: 'B' });
        peer.postMessage({ name: EV.data, data: { id: t.chartInstanceId, n: 2 }, hub: 'A' });
        await tick();
        peer.close();
        expect(cb.mock.calls.map(c => (c[0] as { n: number }).n)).toEqual([2]);
    });

    it('never binds from data addressed to another chart id', async () => {
        const t = await asChartPage('Y');
        const cb = vi.fn();
        await t.chartOn(EV.data, cb);
        const peer = new BroadcastChannel('mogugi-chart');
        peer.postMessage({ name: EV.data, data: { id: 'X', n: 1 }, hub: 'A' });
        peer.postMessage({ name: EV.data, data: { id: t.chartInstanceId, n: 2 }, hub: 'B' });
        peer.postMessage({ name: EV.data, data: { id: t.chartInstanceId, n: 3 }, hub: 'A' });
        await tick();
        peer.close();
        // X's data reaches the (id-filtering) callback but did not bind; B answered for Y first.
        expect(cb.mock.calls.map(c => (c[0] as { n: number }).n)).toEqual([1, 2]);
    });

    it('rebinds after hub:bye to the next hub that announces mainReady, and hello goes there', async () => {
        const t = await asChartPage('X', 'A');
        const ready = vi.fn();
        await t.chartOn(EV.mainReady, ready);
        const peer = new BroadcastChannel('mogugi-chart');
        const got: { name: string; to?: string }[] = [];
        peer.onmessage = e => got.push(e.data);
        peer.postMessage({ name: EV.mainReady, hub: 'B' }); // ignored while bound to A
        peer.postMessage({ name: EV.hubBye, hub: 'A' });
        peer.postMessage({ name: EV.mainReady, hub: 'A2' }); // the reloaded main tab
        await tick();
        expect(ready).toHaveBeenCalledTimes(1);
        t.chartEmit(EV.hello, { id: 'X' });
        t.chartEmit(EV.closed, { id: 'X' });
        await tick();
        peer.close();
        // closed stays unaddressed on purpose (instance ids are unique).
        expect(got.filter(m => m.name === EV.hello || m.name === EV.closed).map(m => m.to)).toEqual(['A2', undefined]);
    });

    it('chartHubId is per page load and the hub pagehide notice is stamped with it', async () => {
        const t = await fresh();
        const peer = new BroadcastChannel('mogugi-chart');
        const got: { name: string; hub?: string }[] = [];
        peer.onmessage = e => got.push(e.data);
        t.chartEmit(EV.hubBye);
        await tick();
        peer.close();
        expect(got[0]).toMatchObject({ name: EV.hubBye, hub: t.chartHubId });
    });

    describe('stale hub recovery', () => {
        const wait = (ms: number) => vi.advanceTimersByTimeAsync(ms);
        const setup = async (hub: string) => {
            const t = await asChartPage('X', hub);
            const peer = new BroadcastChannel('mogugi-chart');
            const got: { name: string; to?: string; data?: unknown }[] = [];
            // Modules from earlier cases keep their channels open; only look at this instance.
            peer.onmessage = e => { if ((e.data?.data as { id?: string } | undefined)?.id === t.chartInstanceId || e.data?.name !== EV.hello) got.push(e.data); };
            await t.chartOn(EV.data, () => {});
            return { t, peer, got };
        };
        beforeEach(() => { vi.useFakeTimers(); });
        afterEach(() => { vi.useRealTimers(); });

        it('a hello to a dead hub falls back to an unaddressed hello and binds to whoever answers', async () => {
            const { t, peer, got } = await setup('OLD');
            t.chartEmit(EV.hello, { id: t.chartInstanceId });
            await wait(100);
            expect(got.filter(m => m.name === EV.hello).map(m => m.to)).toEqual(['OLD']);
            await wait(1500);
            expect(got.filter(m => m.name === EV.hello).map(m => m.to)).toEqual(['OLD', undefined]);
            peer.postMessage({ name: EV.data, data: { id: 'other~1' }, hub: 'Z' });
            peer.postMessage({ name: EV.data, data: { id: t.chartInstanceId }, hub: 'NEW' });
            await wait(100);
            t.chartEmit(EV.hello, { id: t.chartInstanceId });
            await wait(100);
            expect(got.filter(m => m.name === EV.hello).at(-1)!.to).toBe('NEW');
            expect(new URLSearchParams(location.search).get('hub')).toBe('NEW');
            peer.close();
        });

        it('no fallback once the bound hub answers with this chart data', async () => {
            const { t, peer, got } = await setup('A');
            t.chartEmit(EV.hello, { id: t.chartInstanceId });
            peer.postMessage({ name: EV.data, data: { id: t.chartInstanceId }, hub: 'A' });
            await wait(2000);
            expect(got.filter(m => m.name === EV.hello)).toHaveLength(1);
            peer.close();
        });

        it('after the bound hub says bye and no hub announces, it sends an unaddressed hello', async () => {
            const { t, peer, got } = await setup('A');
            t.chartEmit(EV.hello, { id: t.chartInstanceId });
            peer.postMessage({ name: EV.data, data: { id: t.chartInstanceId }, hub: 'A' });
            await wait(100);
            peer.postMessage({ name: EV.hubBye, hub: 'A' });
            await wait(8100);
            await wait(100); // the reply crosses the channel in a second hop
            expect(got.filter(m => m.name === EV.hello).map(m => m.to)).toEqual(['A', undefined]);
            peer.close();
        });

        it('closed is never addressed, and a fallback bind tells other hubs to drop the instance', async () => {
            const { t, peer, got } = await setup('OLD');
            t.chartEmit(EV.hello, { id: t.chartInstanceId });
            await wait(1600); // fallback: unaddressed hello
            peer.postMessage({ name: EV.data, data: { id: t.chartInstanceId }, hub: 'NEW' });
            await wait(200);
            await wait(200);
            expect(got.find(m => m.name === EV.unbind)?.data).toEqual({ id: t.chartInstanceId, keep: 'NEW' });
            t.chartEmit(EV.closed, { id: t.chartInstanceId });
            await wait(200);
            expect(got.filter(m => m.name === EV.closed).every(m => m.to === undefined)).toBe(true);
            expect(got.filter(m => m.name === EV.closed)).toHaveLength(1);
            peer.close();
        });

        it('after bye it waits for the reloaded opener instead of grabbing another hub', async () => {
            const { t, peer, got } = await setup('A');
            const ready = vi.fn();
            await t.chartOn(EV.mainReady, ready);
            t.chartEmit(EV.hello, { id: t.chartInstanceId });
            peer.postMessage({ name: EV.data, data: { id: t.chartInstanceId }, hub: 'A' });
            await wait(100);
            peer.postMessage({ name: EV.hubBye, hub: 'A' });
            await wait(1000);
            expect(got.filter(m => m.name === EV.hello).map(m => m.to)).toEqual(['A']);
            peer.postMessage({ name: EV.mainReady, hub: 'A2' });
            await wait(100);
            expect(ready).toHaveBeenCalledTimes(1);
            await wait(5000);
            expect(got.filter(m => m.name === EV.hello).map(m => m.to)).toEqual(['A']);
            peer.close();
        });

        it('after bye with no mainReady in 8 s it asks every hub', async () => {
            const { t, peer, got } = await setup('A');
            t.chartEmit(EV.hello, { id: t.chartInstanceId });
            peer.postMessage({ name: EV.data, data: { id: t.chartInstanceId }, hub: 'A' });
            await wait(100);
            peer.postMessage({ name: EV.hubBye, hub: 'A' });
            await wait(7500);
            expect(got.filter(m => m.name === EV.hello)).toHaveLength(1);
            await wait(1000);
            expect(got.filter(m => m.name === EV.hello).map(m => m.to)).toEqual(['A', undefined]);
            peer.close();
        });

        it('heartbeats keep a bound chart; silence for 15 s makes it ask every hub', async () => {
            const { t, peer, got } = await setup('A');
            t.chartEmit(EV.hello, { id: t.chartInstanceId });
            peer.postMessage({ name: EV.data, data: { id: t.chartInstanceId }, hub: 'A' });
            for (let i = 0; i < 6; i++) {
                await wait(5000);
                peer.postMessage({ name: EV.hubBeat, hub: 'A' });
                peer.postMessage({ name: EV.hubBeat, hub: 'B' }); // another hub neither refreshes nor rebinds
            }
            expect(got.filter(m => m.name === EV.hello)).toHaveLength(1);
            await wait(16000);
            expect(got.filter(m => m.name === EV.hello).map(m => m.to)).toEqual(['A', undefined]);
            peer.close();
        });

        it('a beat from another hub does not refresh a silent bound hub', async () => {
            const { t, peer, got } = await setup('A');
            t.chartEmit(EV.hello, { id: t.chartInstanceId });
            peer.postMessage({ name: EV.data, data: { id: t.chartInstanceId }, hub: 'A' });
            for (let i = 0; i < 4; i++) { await wait(5000); peer.postMessage({ name: EV.hubBeat, hub: 'B' }); }
            await wait(200);
            expect(got.filter(m => m.name === EV.hello).map(m => m.to).slice(0, 2)).toEqual(['A', undefined]);
            peer.close();
        });

        it('a hello sent while unbound still makes the eventual bind unbind the other hubs', async () => {
            const { t, peer, got } = await setup('A');
            t.chartEmit(EV.hello, { id: t.chartInstanceId });
            peer.postMessage({ name: EV.data, data: { id: t.chartInstanceId }, hub: 'A' });
            await wait(100);
            peer.postMessage({ name: EV.hubBye, hub: 'A' });
            await wait(100);
            t.chartEmit(EV.hello, { id: t.chartInstanceId }); // e.g. an option change during the bye wait
            await wait(100);
            expect(got.filter(m => m.name === EV.hello).map(m => m.to)).toEqual(['A', undefined]);
            peer.postMessage({ name: EV.data, data: { id: t.chartInstanceId }, hub: 'B' });
            await wait(200);
            await wait(200);
            expect(got.find(m => m.name === EV.unbind)?.data).toEqual({ id: t.chartInstanceId, keep: 'B' });
            peer.close();
        });

        it('with no hub answering, unaddressed retries back off to 15 s', async () => {
            const { t, peer, got } = await setup('OLD');
            t.chartEmit(EV.hello, { id: t.chartInstanceId });
            await wait(60000);
            // 1.5 s to the first fallback, then 1.5, 3, 6, 12, 15, 15 s...
            const n = got.filter(m => m.name === EV.hello).length;
            expect(n).toBeGreaterThanOrEqual(6);
            expect(n).toBeLessThanOrEqual(9);
            peer.close();
        });

        it('a rebind on mainReady rewrites ?hub= in the page URL', async () => {
            const { t, peer } = await setup('A');
            await t.chartOn(EV.mainReady, () => {});
            peer.postMessage({ name: EV.hubBye, hub: 'A' });
            peer.postMessage({ name: EV.mainReady, hub: 'A2' });
            await wait(100);
            expect(new URLSearchParams(location.search).get('hub')).toBe('A2');
            peer.close();
        });
    });
});

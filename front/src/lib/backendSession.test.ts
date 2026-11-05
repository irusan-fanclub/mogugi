import { describe, it, expect, vi, beforeEach } from 'vitest';

const sockets: any[] = [];
vi.mock('@/lib/socketClient', () => ({
    SocketClient: class {
        onConnect?: (c: boolean) => void;
        onEvent?: (e: any[]) => void;
        connect = vi.fn();
        constructor(public url: string) { sockets.push(this); }
    },
}));

import { createBackendSession, loadJsonData } from '@/lib/backendSession';
import { appEvent, actorManager, dcManager, setTimeRange, timeRangeMin } from '@/store';
import { computeCCCoverage } from '@/lib/conditionCoverage';

beforeEach(() => { sockets.length = 0; });

describe('loadJsonData', () => {
    it('reads a last line without trailing newline', () => {
        const got: any[] = [];
        loadJsonData('{"EventId":1}\n{"EventId":2}', e => got.push(e.EventId));
        expect(got).toEqual([1, 2]);
    });

    it('skips blank and malformed lines', () => {
        const got: any[] = [];
        const err = vi.spyOn(console, 'error').mockImplementation(() => { });
        loadJsonData('{"EventId":1}\n\n  \nnot json\n{"EventId":3}\n', e => got.push(e.EventId));
        expect(got).toEqual([1, 3]);
        err.mockRestore();
    });
});

describe('createBackendSession', () => {
    const countClears = () => {
        const fn = vi.fn();
        appEvent.value.addEventListener('clear', fn);
        return { fn, off: () => appEvent.value.removeEventListener('clear', fn) };
    };

    it('history session clears data on every (re)connect', () => {
        const c = countClears();
        const s = createBackendSession({ url: 'ws://x/ws?history=1', history: true });
        s.connect();
        sockets[0].onConnect(true);
        sockets[0].onConnect(false);
        sockets[0].onConnect(true);
        expect(c.fn).toHaveBeenCalledTimes(2);
        c.off();

        const c2 = countClears();
        createBackendSession({ url: 'ws://x/ws', history: false });
        sockets[1].onConnect(true);
        sockets[1].onConnect(true);
        expect(c2.fn).toHaveBeenCalledTimes(0);
        c2.off();
    });

    it('maps sessionReset reasons to notice text', () => {
        const s = createBackendSession({ url: 'u', history: false });
        const cases: [string, string][] = [
            ['channel_switch', '偵測到換線'],
            ['replay', '開始重播封包紀錄'],
            ['live', '已回到即時擷取'],
            ['whatever', '偵測到連線異常'],
        ];
        let lastId = -1;
        for (const [reason, text] of cases) {
            sockets[0].onEvent([{ EventId: -2, At: 0, Id: '0', Reason: reason }]);
            expect(s.notice.value?.text).toBe(text);
            expect(s.notice.value!.id).not.toBe(lastId);
            lastId = s.notice.value!.id;
        }
    });

    it('source and connected refs follow socket callbacks', () => {
        const s = createBackendSession({ url: 'u', history: false });
        expect(s.connected.value).toBe(false);
        sockets[0].onConnect(true);
        expect(s.connected.value).toBe(true);
        sockets[0].onConnect(false);
        expect(s.connected.value).toBe(false);

        const state = { Mode: 'replay', File: 'a', Done: 1, Total: 2, Finished: false, Err: '', Notice: '' };
        sockets[0].onEvent([{ EventId: -4, At: 0, Id: '0', ...state }]);
        expect(s.source.value).toBeTruthy();
    });

    it('inDungeon follows zone events and starts false', () => {
        const s = createBackendSession({ url: 'u', history: false });
        expect(s.inDungeon.value).toBe(false);
        sockets[0].onEvent([{ EventId: -7, At: 0, Id: '0', InDungeon: true }]);
        expect(s.inDungeon.value).toBe(true);
        sockets[0].onEvent([{ EventId: -7, At: 0, Id: '0', InDungeon: false }]);
        expect(s.inDungeon.value).toBe(false);
    });

    it('clearData drops a stale dungeon flag', () => {
        const s = createBackendSession({ url: 'u', history: false });
        sockets[0].onEvent([{ EventId: -7, At: 0, Id: '0', InDungeon: true }]);
        expect(s.inDungeon.value).toBe(true);
        s.clearData();
        expect(s.inDungeon.value).toBe(false);
    });

    it('onSourceReset fires when the source changes, not on a reconnect or progress', () => {
        const fn = vi.fn();
        createBackendSession({ url: 'u', history: true, onSourceReset: fn });
        const src = (Mode: string, File: string, Done = 0) =>
            sockets[0].onEvent([{ EventId: -4, At: 0, Id: '0', Mode, File, Done, Total: 9, Finished: false, Err: '', Notice: '' }]);
        sockets[0].onConnect(true);
        src('live', '');
        expect(fn).toHaveBeenCalledTimes(0);
        sockets[0].onEvent([{ EventId: -2, At: 0, Id: '0', Reason: 'replay' }]);
        expect(fn).toHaveBeenCalledTimes(1);
        src('replay', 'a.pcapng');
        src('replay', 'a.pcapng', 5);
        sockets[0].onConnect(false);
        sockets[0].onConnect(true);
        src('replay', 'a.pcapng', 6);
        expect(fn).toHaveBeenCalledTimes(2);
        // Switched while disconnected: only the lead source event tells.
        sockets[0].onConnect(false);
        sockets[0].onConnect(true);
        src('live', '');
        expect(fn).toHaveBeenCalledTimes(3);
        sockets[0].onEvent([{ EventId: -2, At: 0, Id: '0', Reason: 'channel_switch' }]);
        expect(fn).toHaveBeenCalledTimes(3);
    });

    it('historyEvicted evicts and clears a time range reaching into dropped history', () => {
        createBackendSession({ url: 'u', history: false });
        const a = vi.spyOn(actorManager.value, 'evictBefore');
        const d = vi.spyOn(dcManager.value, 'evictBefore');
        setTimeRange(50, 200);
        sockets[0].onEvent([{ EventId: -5, At: 100, Id: '0', Present: ['7'] } as never]);
        expect(a).toHaveBeenCalledWith(100, ['7']);
        expect(d).toHaveBeenCalledWith(100);
        expect(timeRangeMin.value).toBeNull();
        setTimeRange(150, 200);
        sockets[0].onEvent([{ EventId: -5, At: 100, Id: '0' }]);
        expect(timeRangeMin.value).toBe(150);
        a.mockRestore(); d.mockRestore();
    });

    it('ignores historyEvicted while a battle record is loaded, until cleared', async () => {
        const s = createBackendSession({ url: 'u', history: false });
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => '' })));
        const a = vi.spyOn(actorManager.value, 'evictBefore');
        await s.loadBattleRecord('x.ndjson');
        setTimeRange(50, 200);
        sockets[0].onEvent([{ EventId: -5, At: 100, Id: '0' }]);
        expect(a).not.toHaveBeenCalled();
        expect(timeRangeMin.value).toBe(50);
        s.clearData();
        sockets[0].onEvent([{ EventId: -5, At: 100, Id: '0' }]);
        expect(a).toHaveBeenCalledWith(100, undefined);
        a.mockRestore();
        vi.unstubAllGlobals();
    });

    it('a loaded record replaces, not extends, the condition history of entities already on screen', async () => {
        const fight = [
            { EventId: 1, At: 100, Id: '9', Name: 'boss', RaceId: 7603, Height: 1, Weight: 1, Upper: 1, Lower: 1, GuildName: '', OwnerId: '' },
            { EventId: 4, At: 100, Id: '9', CCId: 803, DisableAt: 0, AttackerId: '', Params: {} },
            { EventId: 5, At: 110, Id: '9', CCId: 803 },
        ];
        const s = createBackendSession({ url: 'u', history: false });
        s.clearData();
        // The same fight is still in the live data when its record is loaded (or a record loads twice).
        sockets[0].onEvent(fight);
        const text = fight.map(e => JSON.stringify(e)).join('\n');
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => text })));
        await s.loadBattleRecord('x.ndjson');
        await s.loadBattleRecord('x.ndjson');
        const hist = actorManager.value.entityMap['9'].conditionHistory;
        expect(hist.map(st => st.At)).toEqual([100, 110]);
        expect(computeCCCoverage(hist, [803], 100, 120).onSec).toBe(10);
        vi.unstubAllGlobals();
        s.clearData();
    });
});

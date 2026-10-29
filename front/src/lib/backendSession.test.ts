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
});

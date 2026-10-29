// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { SocketClient } from './socketClient';

class FakeSocket {
    static instances: FakeSocket[] = [];
    readyState = 0;
    onopen?: () => void;
    onclose?: (e: unknown) => void;
    onmessage?: (e: unknown) => void;
    onerror?: (e: unknown) => void;
    constructor(public url: string) { FakeSocket.instances.push(this); }
    close() { this.readyState = 3; this.onclose?.({}); }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); FakeSocket.instances = []; });

describe('SocketClient', () => {
    it('reconnects after an unexpected close', () => {
        vi.useFakeTimers();
        vi.stubGlobal('WebSocket', Object.assign(FakeSocket, { OPEN: 1, CONNECTING: 0 }));
        const c = new SocketClient('ws://x');
        c.connect();
        FakeSocket.instances[0].close();
        vi.advanceTimersByTime(1000);
        expect(FakeSocket.instances).toHaveLength(2);
    });

    it('stays closed after close(), with no reconnect', () => {
        vi.useFakeTimers();
        vi.stubGlobal('WebSocket', Object.assign(FakeSocket, { OPEN: 1, CONNECTING: 0 }));
        const c = new SocketClient('ws://x');
        c.connect();
        c.close();
        vi.advanceTimersByTime(60_000);
        c.connect();
        expect(FakeSocket.instances).toHaveLength(1);
        expect(FakeSocket.instances[0].readyState).toBe(3);
    });
});

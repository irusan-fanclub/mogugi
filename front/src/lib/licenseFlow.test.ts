import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createLicenseFlow } from './licenseFlow';

type Resp = { status: number; ok: boolean; json: () => Promise<unknown> };
const resp = (status: number, body: unknown): Resp => ({ status, ok: status >= 200 && status < 300, json: async () => body });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function setup(startResp: Resp, statusActivated: () => boolean = () => false) {
    const openUrl = vi.fn();
    const fetchFn = vi.fn(async (url: string) => {
        if (url === '/api/license/oauth/start') return startResp;
        return resp(200, { activated: statusActivated() });
    });
    const flow = createLicenseFlow({ fetch: fetchFn as unknown as typeof fetch, openUrl });
    return { flow, openUrl, fetchFn };
}

describe('licenseFlow', () => {
    it('409 puts the flow in error and names the ports', async () => {
        const { flow } = setup(resp(409, {}));
        await flow.start();
        expect(flow.state).toBe('error');
        expect(flow.message).toContain('53682');
    });
    it('ok opens the auth url and waits', async () => {
        const { flow, openUrl } = setup(resp(200, { authUrl: 'https://d/auth' }));
        await flow.start();
        expect(openUrl).toHaveBeenCalledWith('https://d/auth');
        expect(flow.state).toBe('waiting');
        expect(flow.remaining).toBe(120);
        flow.cancel();
    });
    it('a missing authUrl is an error', async () => {
        const { flow, openUrl } = setup(resp(200, {}));
        await flow.start();
        expect(flow.state).toBe('error');
        expect(openUrl).not.toHaveBeenCalled();
    });
    it('a network failure is an error', async () => {
        const flow = createLicenseFlow({ fetch: (async () => { throw new Error('x'); }) as unknown as typeof fetch, openUrl: vi.fn() });
        await flow.start();
        expect(flow.state).toBe('error');
        expect(flow.message).toContain('本機服務');
    });
    it('polls every 1500 ms and reaches activated', async () => {
        let ok = false;
        const { flow, fetchFn } = setup(resp(200, { authUrl: 'u' }), () => ok);
        await flow.start();
        await vi.advanceTimersByTimeAsync(1500);
        expect(fetchFn.mock.calls.filter(c => c[0] === '/api/license/status')).toHaveLength(1);
        expect(flow.state).toBe('waiting');
        ok = true;
        await vi.advanceTimersByTimeAsync(1500);
        expect(flow.state).toBe('activated');
        const calls = fetchFn.mock.calls.length;
        await vi.advanceTimersByTimeAsync(5000);
        expect(fetchFn.mock.calls.length).toBe(calls);
    });
    it('times out after 120 s', async () => {
        const { flow } = setup(resp(200, { authUrl: 'u' }));
        await flow.start();
        await vi.advanceTimersByTimeAsync(119_000);
        expect(flow.state).toBe('waiting');
        expect(flow.remaining).toBe(1);
        await vi.advanceTimersByTimeAsync(1000);
        expect(flow.state).toBe('error');
        expect(flow.message).toContain('授權逾時');
    });
    it('cancel returns to idle and stops polling', async () => {
        const { flow, fetchFn } = setup(resp(200, { authUrl: 'u' }));
        await flow.start();
        flow.cancel();
        expect(flow.state).toBe('idle');
        const calls = fetchFn.mock.calls.length;
        await vi.advanceTimersByTimeAsync(5000);
        expect(fetchFn.mock.calls.length).toBe(calls);
    });
    it('onChange fires and can unsubscribe', async () => {
        const { flow } = setup(resp(409, {}));
        const cb = vi.fn();
        const off = flow.onChange(cb);
        await flow.start();
        expect(cb).toHaveBeenCalled();
        off();
        cb.mockClear();
        flow.cancel();
        expect(cb).not.toHaveBeenCalled();
    });
});

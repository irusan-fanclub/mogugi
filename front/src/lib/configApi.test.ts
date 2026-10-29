import { describe, it, expect, afterEach, vi } from 'vitest';
import { getConfig, putConfig, LicenseRequiredError } from './configApi';
import type { AppConfig } from './appSettings';

const cfg: AppConfig = { savePcapng: false, autoOpenBrowser: true, autoPort: true, port: 8030, memoryLimitMB: 150 };
const reply = (status: number, body: unknown) =>
    vi.fn(async (..._a: unknown[]) => ({ ok: status >= 200 && status < 300, status, json: async () => body }));

afterEach(() => { vi.unstubAllGlobals(); });

describe('configApi', () => {
    it('getConfig returns the body', async () => {
        vi.stubGlobal('fetch', reply(200, { path: 'p' }));
        expect((await getConfig()).path).toBe('p');
    });
    it('getConfig throws LicenseRequiredError on 403', async () => {
        vi.stubGlobal('fetch', reply(403, {}));
        await expect(getConfig()).rejects.toBeInstanceOf(LicenseRequiredError);
    });
    it('getConfig throws HTTP status on other failures', async () => {
        vi.stubGlobal('fetch', reply(500, {}));
        await expect(getConfig()).rejects.toThrow('HTTP 500');
    });
    it('putConfig sends JSON and returns the response', async () => {
        const f = reply(200, { saved: cfg, path: 'p', restartRequired: false });
        vi.stubGlobal('fetch', f);
        expect((await putConfig(cfg)).path).toBe('p');
        const init = f.mock.calls[0][1] as RequestInit;
        expect(init.method).toBe('PUT');
        expect(JSON.parse(init.body as string)).toEqual(cfg);
    });
    it('putConfig throws the server error message', async () => {
        vi.stubGlobal('fetch', reply(400, { error: 'x' }));
        await expect(putConfig(cfg)).rejects.toThrow(new Error('x'));
    });
    it('putConfig falls back to the HTTP status for non-JSON bodies', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => { throw new Error('bad'); } })));
        await expect(putConfig(cfg)).rejects.toThrow('HTTP 502');
    });
    it('putConfig throws LicenseRequiredError on 403', async () => {
        vi.stubGlobal('fetch', reply(403, { error: 'no' }));
        await expect(putConfig(cfg)).rejects.toBeInstanceOf(LicenseRequiredError);
    });
});

import type { AppConfig, ConfigResponse, SaveResponse } from './appSettings';

/** Thrown when the backend answers 403: the license is not activated. */
export class LicenseRequiredError extends Error {
    constructor() {
        super('尚未啟用授權，請先完成啟用。');
        this.name = 'LicenseRequiredError';
    }
}

export async function getConfig(): Promise<ConfigResponse> {
    const r = await fetch('/api/config');
    if (r.status === 403) throw new LicenseRequiredError();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json() as ConfigResponse;
}

export async function putConfig(body: AppConfig & { allowLan?: boolean }): Promise<SaveResponse> {
    const r = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (r.status === 403) throw new LicenseRequiredError();
    if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
            const d = await r.json() as { error?: string };
            if (d.error) msg = d.error;
        } catch { /* non-JSON error body; keep the HTTP status */ }
        throw new Error(msg);
    }
    return await r.json() as SaveResponse;
}

async function postConfigFile(action: 'open' | 'reveal'): Promise<void> {
    const r = await fetch(`/api/files/config/${action}`, { method: 'POST' });
    if (r.status === 403) throw new LicenseRequiredError();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
}
export const openConfigFile = () => postConfigFile('open');
export const revealConfigFile = () => postConfigFile('reveal');

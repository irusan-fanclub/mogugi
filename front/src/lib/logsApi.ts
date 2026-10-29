// logsApi.ts — LOG folder, usage, clear and pack endpoints (/api/logs/*).
import { LicenseRequiredError } from './configApi';

export type LogKind = 'log' | 'pcap';
export interface LogUsage { logBytes: number; pcapBytes: number }
export interface ClearResult { freedBytes: number; failed: string[] }

// 207 (partial clear) is a 2xx, so r.ok covers it and the body carries the failures.
async function call(method: 'GET' | 'POST', url: string): Promise<Response> {
    const r = await fetch(url, { method });
    if (r.status === 403) throw new LicenseRequiredError();
    if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
            const d = await r.json() as { error?: string };
            if (d.error) msg = d.error;
        } catch { /* non-JSON error body; keep the HTTP status */ }
        throw new Error(msg);
    }
    return r;
}

export async function openLogsDir(): Promise<void> { await call('POST', '/api/logs/open'); }

export async function getLogUsage(): Promise<LogUsage> {
    return await (await call('GET', '/api/logs/usage')).json() as LogUsage;
}

export async function clearLogs(kind: LogKind): Promise<ClearResult> {
    const d = await (await call('POST', `/api/logs/clear?kind=${kind}`)).json() as Partial<ClearResult>;
    return { freedBytes: d.freedBytes ?? 0, failed: d.failed ?? [] };
}

export async function packLogs(): Promise<string> {
    return (await (await call('POST', '/api/logs/pack')).json() as { name: string }).name;
}

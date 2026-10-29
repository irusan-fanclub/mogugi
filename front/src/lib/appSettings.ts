// appSettings.ts — settings tab: /api/config types, validation and the
// user-facing hint text (pure; the component only wires them up).
export type DpsDisplay = 'desktop' | 'web';
export interface AppConfig {
    savePcapng: boolean; autoOpenBrowser: boolean; autoPort: boolean; port: number;
    memoryLimitMB: number;
    dpsDisplay?: DpsDisplay;
    allowLan?: boolean;
    savePacketLog?: boolean;
}

export interface ConfigResponse {
    path: string;
    file: AppConfig;
    effective: AppConfig & { lanUrls?: string[] };
    loadError: string;
}

export interface SaveResponse { saved: AppConfig; path: string; restartRequired: boolean }

export const PORT_MIN = 1024;
export const PORT_MAX = 65535;
export const AUTO_PORT_MIN = 8030;
export const AUTO_PORT_MAX = 8040;
export const MEMORY_MIN_MB = 50;
export const MEMORY_MAX_MB = 1000;

export function validatePort(n: number): string | null {
    if (!Number.isInteger(n)) return 'port 必須是整數';
    if (n < PORT_MIN || n > PORT_MAX) return `port 必須在 ${PORT_MIN} 到 ${PORT_MAX} 之間`;
    return null;
}

// validateMemoryLimit: empty string means valid.
export function validateMemoryLimit(v: number): string {
    return Number.isInteger(v) && v >= MEMORY_MIN_MB && v <= MEMORY_MAX_MB
        ? '' : `須介於 ${MEMORY_MIN_MB} 到 ${MEMORY_MAX_MB} MB`;
}

export function isDirty(a: AppConfig, b: AppConfig): boolean {
    return a.savePcapng !== b.savePcapng || (a.savePacketLog ?? false) !== (b.savePacketLog ?? false) || a.autoOpenBrowser !== b.autoOpenBrowser
        || a.autoPort !== b.autoPort || a.port !== b.port
        || a.memoryLimitMB !== b.memoryLimitMB;
}

// dpsDisplayBody: PUT body for the instant DPS-display switch. Built from the
// saved file values so unsaved draft edits are not saved along with it.
export function dpsDisplayBody(file: AppConfig, mode: DpsDisplay): AppConfig {
    return { ...file, dpsDisplay: mode };
}

// effectHints: one line per field that changed, saying when it takes effect.
export function effectHints(saved: AppConfig, previous: AppConfig): string[] {
    const out: string[] = [];
    if (saved.savePcapng !== previous.savePcapng) out.push('保存封包原始紀錄:重新啟動 mogugi 後生效');
    if ((saved.savePacketLog ?? false) !== (previous.savePacketLog ?? false)) out.push('保存LOG:重新啟動 mogugi 後生效');
    if (saved.autoOpenBrowser !== previous.autoOpenBrowser) out.push('自動開啟瀏覽器:下次啟動生效');
    if (saved.autoPort !== previous.autoPort) out.push('自動切換 port:下次啟動生效');
    if (!saved.autoPort && saved.port !== previous.port) out.push(`port:重啟後請改開 http://127.0.0.1:${saved.port}`);
    return out;
}

// saveHints: effectHints plus the restart consequence the server reported.
export function saveHints(saved: AppConfig, previous: AppConfig, restartRequired: boolean): string[] {
    const hints = effectHints(saved, previous);
    if (!restartRequired) return hints;
    if (saved.autoPort) {
        hints.push(`重啟後 port 由自動切換決定(${AUTO_PORT_MIN} 到 ${AUTO_PORT_MAX})`);
    } else if (!hints.some(h => h.startsWith('port:'))) {
        hints.push(`port:重啟後請改開 http://127.0.0.1:${saved.port}`);
    }
    return hints;
}

export function loadErrorNote(msg: string): string {
    return `設定檔有問題,已改用預設值:${msg}。修好檔案後重啟即可。`;
}

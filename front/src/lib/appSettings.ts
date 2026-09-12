// appSettings.ts — settings tab: /api/config types, validation and the
// user-facing hint text (pure; the component only wires them up).
export interface AppConfig { savePcapng: boolean; autoOpenBrowser: boolean; autoPort: boolean; port: number }

export interface ConfigResponse {
    path: string;
    file: AppConfig;
    effective: AppConfig;
    overrides: Partial<Record<keyof AppConfig, string>>;
    loadError: string;
}

export interface SaveResponse { saved: AppConfig; path: string; restartRequired: boolean }

export const PORT_MIN = 1024;
export const PORT_MAX = 65535;
export const AUTO_PORT_MIN = 8030;
export const AUTO_PORT_MAX = 8040;

export function validatePort(n: number): string | null {
    if (!Number.isInteger(n)) return 'port 必須是整數';
    if (n < PORT_MIN || n > PORT_MAX) return `port 必須在 ${PORT_MIN} 到 ${PORT_MAX} 之間`;
    return null;
}

export function isDirty(a: AppConfig, b: AppConfig): boolean {
    return a.savePcapng !== b.savePcapng || a.autoOpenBrowser !== b.autoOpenBrowser
        || a.autoPort !== b.autoPort || a.port !== b.port;
}

// effectHints: one line per field that changed, saying when it takes effect.
export function effectHints(saved: AppConfig, previous: AppConfig): string[] {
    const out: string[] = [];
    if (saved.savePcapng !== previous.savePcapng) out.push('保存封包原始紀錄:重新啟動 mogugi 後生效');
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

export function overrideNote(flag: string): string {
    return `本次執行由啟動參數 ${flag} 覆寫,設定檔的值仍會保存`;
}

export function loadErrorNote(msg: string): string {
    return `設定檔有問題,已改用預設值:${msg}。修好檔案後重啟即可。`;
}

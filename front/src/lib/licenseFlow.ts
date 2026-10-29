// Discord OAuth activation flow, framework-free so the old and new UI share it.
export type LicenseFlowState = 'idle' | 'waiting' | 'activated' | 'error';

export interface LicenseFlow {
    start(): Promise<void>;
    cancel(): void;
    readonly state: LicenseFlowState;
    readonly message: string;
    readonly remaining: number;
    /** True while the start request is in flight. */
    readonly busy: boolean;
    onChange(cb: () => void): () => void;
}

// Matches the Go side's listener window; there is nothing to wait for once
// that closes.
export const WAIT_SECONDS = 120;
export const POLL_MS = 1500;

// Naming the ports is the whole message: with no paste fallback, freeing one
// of them is the user's only way out, and they cannot do that without knowing
// which to look for.
export const PORTS_BUSY_MSG =
    '啟用需要 53682、53683、53684 其中一個連接埠，目前三個都被其他程式占用。'
    + '請關掉占用的程式（rclone 預設會用 53682）後再試一次。';

export function createLicenseFlow(deps: {
    fetch: typeof fetch;
    openUrl: (u: string) => void;
    now?: () => number;
}): LicenseFlow {
    const now = deps.now ?? Date.now;
    const listeners = new Set<() => void>();
    let state: LicenseFlowState = 'idle';
    let message = '';
    let remaining = WAIT_SECONDS;
    let busy = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    let tick: ReturnType<typeof setInterval> | undefined;
    let deadline = 0;

    const emit = () => listeners.forEach(cb => cb());
    const set = (s: LicenseFlowState, m: string) => { state = s; message = m; emit(); };

    const stopTimers = () => {
        if (poll !== undefined) clearInterval(poll);
        if (tick !== undefined) clearInterval(tick);
        poll = tick = undefined;
    };

    // The Go side activates as soon as Discord calls back, so the frontend
    // only has to notice that it happened.
    const startPolling = () => {
        deadline = now() + WAIT_SECONDS * 1000;
        remaining = WAIT_SECONDS;
        set('waiting', '');

        tick = setInterval(() => {
            remaining = Math.max(0, Math.ceil((deadline - now()) / 1000));
            if (remaining <= 0) {
                stopTimers();
                set('error', '授權逾時，請再試一次。');
            } else {
                emit();
            }
        }, 1000);

        poll = setInterval(async () => {
            try {
                const r = await deps.fetch('/api/license/status');
                if (state === 'waiting' && (await r.json()).activated) {
                    stopTimers();
                    set('activated', '');
                }
            } catch { /* 本機服務短暫沒回應就等下一次 */ }
        }, POLL_MS);
    };

    return {
        async start() {
            if (busy || state === 'waiting') return;
            message = '';
            busy = true;
            emit();
            try {
                const r = await deps.fetch('/api/license/oauth/start', { method: 'POST' });
                const data = await r.json();
                if (r.status === 409) {
                    set('error', PORTS_BUSY_MSG);
                    return;
                }
                if (!r.ok || !data.authUrl) {
                    set('error', '無法開始授權，請稍後再試。');
                    return;
                }
                deps.openUrl(data.authUrl);
                startPolling();
            } catch {
                set('error', '無法連線到本機服務，請稍後再試。');
            } finally {
                busy = false;
                emit();
            }
        },
        cancel() {
            stopTimers();
            set('idle', '已取消等待。授權頁面若已開啟，可以直接關掉。');
        },
        get state() { return state; },
        get message() { return message; },
        get remaining() { return remaining; },
        get busy() { return busy; },
        onChange(cb) {
            listeners.add(cb);
            return () => { listeners.delete(cb); };
        },
    };
}

import { isDesktop } from './runtimeEnv';
import { emitDesktop, onDesktopEvent } from './desktopBridge';
import { EV } from './chartProtocol';

// Desktop chart windows talk over Wails events; browser tabs over a BroadcastChannel.
let bc: BroadcastChannel | undefined;

// Hub -> chart events carry the sending hub's id (one per page load); a chart
// binds to one hub and ignores the rest, so two main tabs never mix data.
const DOWNSTREAM: ReadonlySet<string> = new Set([EV.data, EV.rangeSync, EV.mainReady, EV.hubBye, EV.hubBeat]);
interface Msg { name?: unknown; data?: unknown; hub?: unknown; to?: unknown }

export const chartHubId = Math.random().toString(36).slice(2) + Date.now().toString(36);

// A chart page is opened with ?id=&spec=&hub=: it starts bound to its opener.
const pageQuery = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const chartPageId = pageQuery.has('spec') ? pageQuery.get('id') ?? undefined : undefined;
// Per page instance, so a duplicated tab closing never unregisters its twin.
export const chartInstanceId = chartPageId ? `${chartPageId}~${Math.random().toString(36).slice(2, 8)}` : undefined;
let boundHub: string | undefined = chartPageId ? pageQuery.get('hub') ?? undefined : undefined;

// Keep ?hub= current so a reloaded or restored chart tab does not start bound to a dead hub.
// After an unaddressed hello every live hub registered us: tell the others to drop it.
function bind(hub: string): void {
    boundHub = hub;
    clearTimeout(byeTimer);
    byeTimer = undefined;
    if (askedAny && bc && chartInstanceId) {
        bc.postMessage({ name: EV.unbind, data: { id: chartInstanceId, keep: hub } });
    }
    askedAny = false;
    retryMs = ANSWER_MS;
    touchHub();
    if (!chartPageId) return;
    try {
        const u = new URL(location.href);
        u.searchParams.set('hub', hub);
        history.replaceState(null, '', u);
    } catch { /* no history API */ }
}

// A bound chart that gets no data for itself assumes its hub is gone and asks everyone.
const ANSWER_MS = 1500;
// After bye, give the reloaded opener this long to announce (it waits on the license check).
const BYE_WAIT_MS = 8000;
// With no hub answering, unaddressed retries back off up to this.
const RETRY_MAX_MS = 15000;
// A bound hub silent (no data, no beat) this long is treated as crashed.
const SILENT_MS = 15000;
let lastHello: unknown;
let askedAny = false;
let retryMs = ANSWER_MS;
let answerTimer: ReturnType<typeof setTimeout> | undefined;
let byeTimer: ReturnType<typeof setTimeout> | undefined;
let silentTimer: ReturnType<typeof setTimeout> | undefined;
function askAnyHub(): void {
    clearTimeout(answerTimer);
    clearTimeout(byeTimer);
    clearTimeout(silentTimer);
    answerTimer = byeTimer = silentTimer = undefined;
    if (lastHello === undefined || !bc) return;
    boundHub = undefined;
    askedAny = true;
    bc.postMessage({ name: EV.hello, data: lastHello });
    answerTimer = setTimeout(askAnyHub, retryMs);
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
}
// Any sign of life from the bound hub restarts the crash watch.
function touchHub(): void {
    clearTimeout(silentTimer);
    silentTimer = undefined;
    if (chartInstanceId && boundHub && lastHello !== undefined) silentTimer = setTimeout(askAnyHub, SILENT_MS);
}

const channel = () => {
    if (!bc) {
        bc = new BroadcastChannel('mogugi-chart');
        bc.addEventListener('message', e => {
            const m = e.data as Msg | null;
            if (!m || typeof m.hub !== 'string' || m.hub !== boundHub) return;
            if (m.name === EV.hubBye) {
                // Its page is going away (maybe a reload): wait for it to come back before asking others.
                boundHub = undefined;
                clearTimeout(silentTimer);
                silentTimer = undefined;
                if (chartInstanceId) { clearTimeout(byeTimer); byeTimer = setTimeout(askAnyHub, BYE_WAIT_MS); }
            } else {
                touchHub();
            }
        });
    }
    return bc;
};

export function chartEmit(name: string, data?: unknown): void {
    if (isDesktop()) { void emitDesktop(name, data); return; }
    // Chart-to-hub payloads are small and may hold Vue proxies, which postMessage cannot clone.
    const plain = DOWNSTREAM.has(name) || data === undefined ? data : JSON.parse(JSON.stringify(data));
    const msg: Msg = { name, data: plain };
    if (DOWNSTREAM.has(name)) msg.hub = chartHubId;
    // closed and unbind stay unaddressed: instance ids are unique, so only that instance goes.
    else if (boundHub && name !== EV.closed && name !== EV.unbind) msg.to = boundHub;
    channel().postMessage(msg);
    if (name === EV.hello && chartInstanceId) {
        lastHello = plain;
        // Unaddressed, every live hub registers us: the eventual bind must unbind the others.
        if (!boundHub) askedAny = true;
        clearTimeout(answerTimer);
        answerTimer = setTimeout(askAnyHub, ANSWER_MS);
        touchHub();
    }
}

export async function chartOn(name: string, cb: (data: unknown) => void): Promise<(() => void) | undefined> {
    if (isDesktop()) return onDesktopEvent(name, cb);
    const ch = channel();
    const h = (e: MessageEvent) => {
        const m = e.data as Msg | null;
        if (!m || m.name !== name) return;
        if (DOWNSTREAM.has(name)) {
            if (typeof m.hub === 'string') {
                if (boundHub && boundHub !== m.hub) return;
                // Bind on a hub's mainReady or on data for this very chart, never on another chart's data.
                const own = name === EV.data && (!chartInstanceId || (m.data as { id?: unknown } | null)?.id === chartInstanceId);
                if (!boundHub && (name === EV.mainReady || own)) bind(m.hub);
                if (own && chartInstanceId) { clearTimeout(answerTimer); answerTimer = undefined; }
            }
        } else if (typeof m.to === 'string' && m.to !== chartHubId) return;
        cb(m.data);
    };
    ch.addEventListener('message', h);
    return () => ch.removeEventListener('message', h);
}

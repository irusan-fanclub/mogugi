import { ref, type Ref } from 'vue';
import { LicenseRequiredError } from '@/lib/configApi';
import { SocketClient } from '@/lib/socketClient';
import { dispatchEvents } from '@/lib/eventDispatch';
import type { eventBase, sourceState } from '@/protocols';
import {
    actorManager, dcManager, appEvent, clearTimeRange,
    captureStatus, ownerCharacterName, ownerEquipment, ownerProfile, ownerStats, timeRangeMin,
} from '@/store';

export interface BackendSession {
    connected: Ref<boolean>;
    ownerName: Ref<string>;
    source: Ref<sourceState | null>;
    notice: Ref<{ id: number; text: string } | null>;
    messageBox: Ref<string | null>;
    connect(): void;
    /** Closes the socket for good. */
    close(): void;
    clearData(): void;
    loadText(text: string): void;
    reloadFromServer(): Promise<void>;
    loadBattleRecord(file: string): Promise<void>;
}

/** Parses NDJSON text line by line; the last line needs no trailing newline. */
export function loadJsonData(text: string, onEvent: (e: eventBase) => void): void {
    let count = 0;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        count++;
        try {
            onEvent(JSON.parse(line));
        } catch (e) {
            console.error(e);
        }
    }
    console.log(`loaded ${count} events`);
}

function noticeText(reason: string): string {
    return reason === 'channel_switch' ? '偵測到換線'
        : reason === 'replay' ? '開始重播封包紀錄'
        : reason === 'live' ? '已回到即時擷取'
        : '偵測到連線異常';
}

export function createBackendSession(opts: {
    url: string; history: boolean; onBattleBoundary?: (at: number, present?: string[]) => void;
}): BackendSession {
    const connected = ref(false);
    const ownerName = ref('');
    const source = ref<sourceState | null>(null);
    const notice = ref<{ id: number; text: string } | null>(null);
    const messageBox = ref<string | null>(null);
    let noticeId = 0;

    // True while a saved battle record is on screen; live eviction must not touch it.
    let recordLoaded = false;

    const clearData = () => {
        recordLoaded = false;
        appEvent.value.dispatchEvent(new CustomEvent('clear'));
        actorManager.value.clear();
        dcManager.value.clear();
        clearTimeRange();
    };

    const loadText = (text: string) => loadJsonData(text, e => actorManager.value.onEvent(e));

    const socket = new SocketClient(opts.url);
    socket.onConnect = isConnected => {
        connected.value = isConnected;
        // History mode: the server replays the whole history on each connect.
        if (isConnected && opts.history) clearData();
    };
    socket.onEvent = (events) => dispatchEvents(events, {
        messageBox: (text) => { messageBox.value = (messageBox.value ?? '') + `${text}\n`; },
        ownerName: (name) => { ownerName.value = name; ownerCharacterName.value = name; },
        captureStatus: (e) => {
            captureStatus.value = {
                npcapOk: e.NpcapOk,
                gameDetected: e.GameDetected,
                capturing: e.Capturing,
                lastPacketAt: e.LastPacketAt,
            };
        },
        ownerEquipment: (items) => { ownerEquipment.value = items; },
        ownerStats: (panel) => { ownerStats.value = panel; },
        ownerProfile: (profile) => { ownerProfile.value = profile; },
        sessionReset: (reason) => {
            notice.value = { id: ++noticeId, text: noticeText(reason) };
            ownerEquipment.value = [];
            ownerStats.value = null;
            ownerProfile.value = null;
        },
        configChanged: () => { /* callers read config on demand */ },
        sourceChanged: (state) => { source.value = state; },
        clearData,
        historyEvicted: (at, present) => {
            if (recordLoaded) return;
            actorManager.value.evictBefore(at, present);
            dcManager.value.evictBefore(at);
            // A selected range reaching into dropped history no longer matches any data.
            if (timeRangeMin.value !== null && timeRangeMin.value < at) clearTimeRange();
        },
        battleBoundary: (at, present) => opts.onBattleBoundary?.(at, present),
        battle: (e) => actorManager.value.onEvent(e),
    });

    const reloadFromServer = async () => {
        const prevHandler = socket.onEvent;
        const buffered: eventBase[] = [];
        try {
            const res = await fetch('/api/packet_log');
            if (!res.ok) throw new Error(`failed to fetch data ${res.status}`);
            socket.onEvent = (e) => buffered.push(...e);
            const text = await res.text();
            clearData();
            loadText(text);
        } catch (e) {
            console.error(e);
            alert(`failed to load data ${e}`);
        } finally {
            socket.onEvent = prevHandler;
            for (const e of buffered) actorManager.value.onEvent(e);
            buffered.length = 0;
        }
    };

    // Loads data only; the caller switches tabs.
    const loadBattleRecord = async (file: string) => {
        const res = await fetch('/api/battles/content?file=' + encodeURIComponent(file));
        if (res.status === 403) throw new LicenseRequiredError();
        if (!res.ok) throw new Error(`failed to fetch record ${res.status}`);
        const text = await res.text();
        clearData();
        loadText(text);
        recordLoaded = true;
    };

    return {
        connected, ownerName, source, notice, messageBox,
        connect: () => socket.connect(),
        close: () => socket.close(),
        clearData, loadText, reloadFromServer, loadBattleRecord,
    };
}

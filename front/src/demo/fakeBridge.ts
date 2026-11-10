// Demo stand-in for desktopBridge: an in-page event bus plus a fake Go overlay core.
import { reactive } from 'vue';
import type { OverlayLayout, OverlayState } from '@/lib/overlayProtocol';

type Cb = (data: unknown) => void;
const listeners = new Map<string, Set<Cb>>();

/** Scenario switches shown in the demo's control bar. */
export const scenario = reactive({ licensed: true, gameFound: true, elevated: true });

const core = {
    locked: true,
    hidden: false,
    hotkey: 'Ctrl+Alt+L',
    hotkeyError: '',
    visibleHotkey: 'Ctrl+Alt+O',
    visibleHotkeyError: '',
    elevateError: '',
    // Like Go: empty until something is saved, so every component starts at its default.
    layout: {} as Record<string, OverlayLayout>,
};

function stateMsg(): OverlayState {
    return {
        locked: core.locked, hotkey: core.hotkey, hotkeyError: core.hotkeyError,
        licensed: scenario.licensed, elevated: scenario.elevated, elevateError: core.elevateError,
        hidden: core.hidden, visibleHotkey: core.visibleHotkey, visibleHotkeyError: core.visibleHotkeyError,
        layout: JSON.parse(JSON.stringify(core.layout)), gameFound: scenario.gameFound,
    };
}

function dispatch(name: string, data: unknown) {
    for (const cb of listeners.get(name) ?? []) cb(data);
}

export const pushState = () => dispatch('overlay:state', stateMsg());

/** Demo setup: a saved layout before the page starts. */
export const seedLayout = (id: string, l: OverlayLayout) => { core.layout[id] = l; };

const HOTKEY_RE = /^(Ctrl\+)?(Alt\+)?(Shift\+)?([A-Z0-9]|F([1-9]|1[0-2]))$/;
const okHotkey = (h: string) => HOTKEY_RE.test(h) && /Ctrl|Alt/.test(h);

function handle(name: string, data: unknown) {
    const p = (data ?? {}) as Record<string, unknown>;
    switch (name) {
        case 'overlay:get-state': break;
        case 'overlay:set-layout': core.layout[p.id as string] = p.layout as OverlayLayout; break;
        case 'overlay:remove-layout': delete core.layout[p.id as string]; break;
        case 'overlay:replace-layouts': {
            for (const id of (p.removes as string[] | undefined) ?? []) delete core.layout[id];
            Object.assign(core.layout, p.saves as Record<string, OverlayLayout> | undefined);
            break;
        }
        case 'overlay:set-locked': core.locked = !!p.locked; break;
        case 'overlay:set-hidden': core.hidden = !!p.hidden; break;
        case 'overlay:set-hotkey': {
            const h = String(p.hotkey);
            if (okHotkey(h)) { core.hotkey = h; core.hotkeyError = ''; } else core.hotkeyError = `快捷鍵 ${h} 格式不正確，需包含 Ctrl 或 Alt，加上 A–Z、0–9 或 F1–F12`;
            break;
        }
        case 'overlay:set-visible-hotkey': {
            const h = String(p.hotkey);
            if (okHotkey(h)) { core.visibleHotkey = h; core.visibleHotkeyError = ''; } else core.visibleHotkeyError = `快捷鍵 ${h} 格式不正確，需包含 Ctrl 或 Alt，加上 A–Z、0–9 或 F1–F12`;
            break;
        }
        case 'overlay:restart-elevated': core.elevateError = '（demo）不會真的重新啟動'; break;
        default: return false;
    }
    pushState();
    return true;
}

export async function onDesktopEvent(name: string, cb: Cb): Promise<(() => void) | undefined> {
    let set = listeners.get(name);
    if (!set) listeners.set(name, set = new Set());
    set.add(cb);
    return () => { set.delete(cb); };
}

export async function emitDesktop(name: string, data?: unknown): Promise<void> {
    if (!handle(name, data)) dispatch(name, data);
}

export async function desktopWindow() { return undefined; }
export async function initDesktop(): Promise<void> { /* nothing to load */ }

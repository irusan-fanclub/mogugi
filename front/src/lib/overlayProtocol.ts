// Event names and payloads shared by the Go overlay manager and the overlay pages.
export const OV = {
    getState: 'overlay:get-state',
    setLayout: 'overlay:set-layout',
    setLocked: 'overlay:set-locked',
    setHotkey: 'overlay:set-hotkey',
    setVisibleHotkey: 'overlay:set-visible-hotkey',
    setHidden: 'overlay:set-hidden',
    state: 'overlay:state',
    hello: 'overlay:hello',
    target: 'overlay:target',
    settings: 'overlay:settings',
    restartElevated: 'overlay:restart-elevated',
} as const;

export type Anchor = 'tl' | 'tr' | 'bl' | 'br' | 'center';
export type ComponentId = 'dps' | 'cc' | 'cooldown' | 'alerts';

export interface OverlayLayout {
    enabled: boolean;
    anchor: Anchor;
    x: number;
    y: number;
    width: number;
    maxRows: number;
}

export interface OverlayState {
    locked: boolean;
    hotkey: string;
    hotkeyError: string;
    licensed: boolean;
    /** False when in-game hotkeys cannot work: the game runs as admin, mogugi not. */
    elevated: boolean;
    elevateError: string;
    /** All overlays closed by the show/hide hotkey; layouts are untouched. */
    hidden: boolean;
    visibleHotkey: string;
    visibleHotkeyError: string;
    /** Stored layouts by component id; a missing id means the component default. */
    layout: Partial<Record<string, OverlayLayout>>;
    gameFound: boolean;
}

export function isOverlayState(v: unknown): v is OverlayState {
    if (typeof v !== 'object' || v === null) return false;
    const o = v as Record<string, unknown>;
    return typeof o.locked === 'boolean'
        && typeof o.hotkey === 'string'
        && typeof o.hotkeyError === 'string'
        && typeof o.licensed === 'boolean'
        && typeof o.elevated === 'boolean'
        && typeof o.elevateError === 'string'
        && typeof o.hidden === 'boolean'
        && typeof o.visibleHotkey === 'string'
        && typeof o.visibleHotkeyError === 'string'
        && typeof o.layout === 'object' && o.layout !== null
        && typeof o.gameFound === 'boolean';
}

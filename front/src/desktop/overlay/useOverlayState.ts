import { ref, type Ref } from 'vue';
import { isDesktop } from '@/lib/runtimeEnv';
import { emitDesktop, onDesktopEvent } from '@/lib/desktopBridge';
import { isOverlayState, OV, type ComponentId, type OverlayLayout, type OverlayState } from '@/lib/overlayProtocol';

// One listener and one state for the whole app, set up on first use.
const state = ref<OverlayState | null>(null);
// Bumped by every setHotkey / setVisibleHotkey so a repeated identical failure can be toasted again.
const hotkeyAttempts = ref(0);
const visibleHotkeyAttempts = ref(0);
let started = false;

function start() {
    if (started || !isDesktop()) return;
    started = true;
    void onDesktopEvent(OV.state, d => { if (isOverlayState(d)) state.value = d; })
        .then(() => emitDesktop(OV.getState));
}

export function useOverlayState(): {
    state: Ref<OverlayState | null>;
    setLayout(id: ComponentId, layout: OverlayLayout): void;
    removeLayout(id: ComponentId): void;
    replaceLayouts(saves: Record<string, OverlayLayout>, removes: string[]): void;
    setLocked(on: boolean): void;
    setHotkey(h: string): void;
    setHidden(on: boolean): void;
    setVisibleHotkey(h: string): void;
    restartElevated(): void;
    refresh(): Promise<void>;
    hotkeyAttempts: Ref<number>;
    visibleHotkeyAttempts: Ref<number>;
} {
    start();
    return {
        state,
        setLayout: (id, layout) => { void emitDesktop(OV.setLayout, { id, layout }); },
        removeLayout: id => { void emitDesktop(OV.removeLayout, { id }); },
        replaceLayouts: (saves, removes) => { void emitDesktop(OV.replaceLayouts, { saves, removes }); },
        setLocked: locked => { void emitDesktop(OV.setLocked, { locked }); },
        setHotkey: hotkey => { hotkeyAttempts.value++; void emitDesktop(OV.setHotkey, { hotkey }); },
        setHidden: hidden => { void emitDesktop(OV.setHidden, { hidden }); },
        setVisibleHotkey: hotkey => { visibleHotkeyAttempts.value++; void emitDesktop(OV.setVisibleHotkey, { hotkey }); },
        restartElevated: () => { void emitDesktop(OV.restartElevated); },
        refresh: () => emitDesktop(OV.getState),
        hotkeyAttempts,
        visibleHotkeyAttempts,
    };
}

/** Test hook: forgets the shared listener state. */
export function resetOverlayStateForTest() {
    started = false;
    state.value = null;
}

import { ref, watch } from 'vue';
import { emitDesktop, onDesktopEvent } from '@/lib/desktopBridge';
import { OV } from '@/lib/overlayProtocol';
import {
    loadOverlaySettings, normalizeOverlaySettings, saveOverlaySettings, type OverlaySettings,
} from '@/lib/overlaySettings';
import { selectedTargetId } from '../tabs/battle/battleSelection';

export const overlaySettings = ref<OverlaySettings>(loadOverlaySettings());

const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v));

function emitSettings() {
    void emitDesktop(OV.settings, plain(overlaySettings.value));
}

/** Applies the mutation, persists the result and pushes it to the overlay windows. */
export function updateOverlaySettings(mut: (s: OverlaySettings) => void): void {
    const next = plain(overlaySettings.value);
    mut(next);
    overlaySettings.value = normalizeOverlaySettings(next);
    saveOverlaySettings(overlaySettings.value);
    emitSettings();
}

const emitTarget = () => { void emitDesktop(OV.target, { targetId: selectedTargetId.value }); };

/** Announces the battle target and the settings to overlay windows; resolves to a stop function. */
export async function startOverlayLink(): Promise<() => void> {
    const stopWatch = watch(selectedTargetId, emitTarget);
    const off = await onDesktopEvent(OV.hello, () => {
        emitTarget();
        emitSettings();
    });
    return () => {
        stopWatch();
        off?.();
    };
}

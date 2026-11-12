import { watch } from 'vue';
import { missingFrameRecords } from '@/lib/overlayFrames';
import { overlaySettings } from './overlayLink';
import { useOverlayState } from './useOverlayState';

/** Gives every pulled frame without a record a default name and number, via replaceLayouts. */
export function startFrameRecords(): () => void {
    const { state, replaceLayouts } = useOverlayState();
    // JSON of the last saves sent; kept until a state arrives with nothing missing.
    let sent = '';
    return watch(
        () => [state.value?.layout, overlaySettings.value] as const,
        ([layout, settings]) => {
            if (!layout) return;
            const saves = missingFrameRecords(settings, layout);
            if (Object.keys(saves).length === 0) { sent = ''; return; }
            const json = JSON.stringify(saves);
            if (json === sent) return;
            sent = json;
            replaceLayouts(saves, []);
        },
        { immediate: true, deep: true },
    );
}

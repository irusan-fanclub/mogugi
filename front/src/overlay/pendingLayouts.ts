import { computed, onBeforeUnmount, reactive, watch } from 'vue';
import { emitDesktop } from '@/lib/desktopBridge';
import { sameLayout } from '@/lib/overlayLayout';
import { OV, type ComponentId, type OverlayLayout, type OverlayState } from '@/lib/overlayProtocol';

const PENDING_MAX_MS = 2000;

/**
 * Stored layouts with local saves and removals applied at once; each one is dropped when Go
 * echoes it back in overlay:state, or after a while if no echo arrives.
 */
export function usePendingLayouts(stored: () => OverlayState['layout'] | undefined) {
    const pending = reactive<Record<ComponentId, OverlayLayout>>({});
    const removed = reactive<Record<ComponentId, true>>({});
    const timers = new Map<ComponentId, ReturnType<typeof setTimeout>>();

    function settle(id: ComponentId) {
        delete pending[id];
        delete removed[id];
        clearTimeout(timers.get(id));
        timers.delete(id);
    }
    function arm(id: ComponentId) {
        clearTimeout(timers.get(id));
        timers.set(id, setTimeout(() => settle(id), PENDING_MAX_MS));
    }

    watch(stored, st => {
        for (const id of Object.keys(pending)) {
            const got = st?.[id];
            if (got && sameLayout(pending[id], got)) settle(id);
        }
        for (const id of Object.keys(removed)) if (!st?.[id]) settle(id);
    });
    onBeforeUnmount(() => { timers.forEach(t => clearTimeout(t)); });

    const layouts = computed<OverlayState['layout']>(() => {
        const out: OverlayState['layout'] = { ...(stored() ?? {}), ...pending };
        for (const id of Object.keys(removed)) delete out[id];
        return out;
    });

    function save(id: ComponentId, layout: OverlayLayout) {
        delete removed[id];
        pending[id] = layout;
        arm(id);
        void emitDesktop(OV.setLayout, { id, layout });
    }
    function remove(id: ComponentId) {
        delete pending[id];
        removed[id] = true;
        arm(id);
        void emitDesktop(OV.removeLayout, { id });
    }

    return { layouts, save, remove };
}

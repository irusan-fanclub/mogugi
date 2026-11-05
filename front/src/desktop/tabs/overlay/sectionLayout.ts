import { computed } from 'vue';
import { layoutOf, sectionItems } from '@/lib/overlayComponents';
import { frameOfKey, planTakeOut, type LayoutOp } from '@/lib/overlayGroups';
import { itemKey, orderedKeys, type SectionId } from '@/lib/overlaySections';
import { overlaySettings } from '../../overlay/overlayLink';
import { useOverlayState } from '../../overlay/useOverlayState';

/** The layout side of a section's item list: pulled-out units and groups, and the section order. */
export function useSectionLayout(section: () => SectionId) {
    const { state, setLayout, removeLayout } = useOverlayState();
    const layouts = computed(() => state.value?.layout);

    /** The item is drawn outside the section frame: in a unit or a group. */
    const isSolo = (key: string) => frameOfKey(section(), key, layouts.value) !== section();
    // Followers docked under a removed frame go to its heir, else keep x/y and take its own dock (or none).
    function apply(ops: LayoutOp[]) {
        for (const op of ops) {
            if ('save' in op) { setLayout(op.save, op.layout); continue; }
            const id = op.remove;
            const host = op.heir ?? layouts.value?.[id]?.dock ?? '';
            for (const oid of Object.keys(layouts.value ?? {})) {
                const lay = layoutOf(oid, layouts.value);
                if (oid !== id && lay.dock === id) setLayout(oid, { ...lay, dock: host });
            }
            removeLayout(id);
        }
    }
    function recall(key: string) {
        const sec = section();
        const keys = sectionItems(overlaySettings.value, sec).map(itemKey);
        apply(planTakeOut({ sec, layouts: layouts.value, layoutOf: id => layoutOf(id, layouts.value), keys }, [key], frameOfKey(sec, key, layouts.value)));
    }
    const inOrder = (keys: string[]) => orderedKeys(keys, layouts.value?.[section()]?.order);

    /** A removed item: its own frame and its order entry go too. */
    function forget(key: string) {
        if (isSolo(key)) recall(key);
        const stored = layouts.value?.[section()];
        if (stored?.order?.includes(key)) setLayout(section(), { ...stored, order: stored.order.filter(k => k !== key) });
    }
    return { isSolo, recall, inOrder, forget };
}

import { computed, ref } from 'vue';
import { componentsOf, layoutOf, sectionItems } from '@/lib/overlayComponents';
import {
    defaultFrameRec, frameField, parseFrame, resetFrameRec, sectionTitle, type FrameRec, type SectionLook,
} from '@/lib/overlayFrames';
import { frameOfKey, planTakeOut, type LayoutOp } from '@/lib/overlayGroups';
import type { ComponentId } from '@/lib/overlayProtocol';
import { cleanTitleText, itemKey, orderedKeys, type SectionId } from '@/lib/overlaySections';
import { frameSummary } from './frameSummary';
import { overlaySettings } from '../../overlay/overlayLink';
import { useOverlayState } from '../../overlay/useOverlayState';

/** The layout side of a section's item list: its frames (main, then pulled-out ones) and the section order. */
export function useSectionLayout(section: () => SectionId) {
    const { state, setLayout, removeLayout } = useOverlayState();
    const layouts = computed(() => state.value?.layout);

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

    type FrameKind = 'section' | 'unit' | 'group';
    interface FrameInfo { id: ComponentId; kind: FrameKind; keys: string[]; rec: FrameRec | null }
    /** The section frame first, then pulled frames by record number (unrecorded last, by id). */
    const frames = computed((): FrameInfo[] => {
        const sec = section();
        const pulled = componentsOf(overlaySettings.value, layouts.value)
            .filter(c => c.section === sec && (c.kind === 'unit' || c.kind === 'group'))
            .map((c): FrameInfo => ({
                id: c.id, kind: c.kind as FrameKind, keys: c.kind === 'unit' ? [c.key!] : (c.keys ?? []),
                rec: parseFrame(sec, layouts.value?.[c.id]?.frame),
            }))
            .sort((a, b) => (a.rec ? a.rec.n : Infinity) - (b.rec ? b.rec.n : Infinity) || (a.id < b.id ? -1 : 1));
        const taken = new Set(pulled.flatMap(f => f.keys));
        const all = inOrder(sectionItems(overlaySettings.value, sec).map(itemKey));
        return [{ id: sec, kind: 'section', keys: all.filter(k => !taken.has(k)), rec: null }, ...pulled];
    });
    function setFrame(id: ComponentId, rec: FrameRec) {
        setLayout(id, { ...layoutOf(id, layouts.value), frame: frameField(rec) });
    }
    return { isSolo, recall, inOrder, forget, frames, setFrame };
}

export interface FrameBlockView {
    id: ComponentId; kind: 'section' | 'unit' | 'group'; keys: string[];
    title: string; summary: string; open: boolean;
    /** The look the fields edit; title fields are the frame's own. */
    look: SectionLook;
    /** null on the main frame. */
    follow: boolean | null;
}

/** Everything a settings page needs to draw and edit its frame blocks. */
export function useFrameBlocks(
    section: () => SectionId,
    sectionLook: () => SectionLook,
    setSectionLook: (look: SectionLook) => void,
    resetSectionLook: () => void,
) {
    const { frames, setFrame } = useSectionLayout(section);
    const openIds = ref(new Set<ComponentId>());
    const clone = (l: SectionLook): SectionLook => JSON.parse(JSON.stringify(l));

    // A frame whose record has not arrived yet shows the name it is about to get.
    const recs = computed(() => {
        const sec = section();
        const used = new Set(frames.value.flatMap(f => f.rec ? [f.rec.n] : []));
        const out = new Map<ComponentId, FrameRec>();
        for (const f of frames.value) {
            if (f.kind === 'section') continue;
            let rec = f.rec;
            if (!rec) {
                let n = 1;
                while (used.has(n)) n++;
                used.add(n);
                rec = defaultFrameRec(sec, f.kind, n);
            }
            out.set(f.id, rec);
        }
        return out;
    });

    const blocks = computed((): FrameBlockView[] => frames.value.map(f => {
        const sec = section();
        const open = openIds.value.has(f.id);
        const main = sectionLook();
        if (f.kind === 'section') {
            const title = sectionTitle(overlaySettings.value, sec);
            return { id: f.id, kind: f.kind, keys: f.keys, title, open, look: main, follow: null, summary: frameSummary(main, sec, null) };
        }
        const rec = recs.value.get(f.id)!;
        const look = { ...(rec.look ?? main), title: rec.titleOn ?? main.title, titleText: rec.name } as SectionLook;
        const follow = rec.look === null;
        return {
            id: f.id, kind: f.kind, keys: f.keys, title: rec.name, open, look, follow,
            summary: frameSummary(look, sec, follow ? sectionTitle(overlaySettings.value, sec) : null),
        };
    }));

    const toggle = (id: ComponentId) => {
        const next = new Set(openIds.value);
        if (!next.delete(id)) next.add(id);
        openIds.value = next;
    };
    function onLook(id: ComponentId, look: SectionLook) {
        const b = blocks.value.find(x => x.id === id);
        if (!b) return;
        if (b.kind === 'section') { setSectionLook(look); return; }
        const rec = recs.value.get(id)!;
        const sec = section();
        setFrame(id, {
            ...rec,
            titleOn: look.title !== b.look.title ? look.title : rec.titleOn,
            name: cleanTitleText(look.titleText) || defaultFrameRec(sec, b.kind, rec.n).name,
            look: b.follow ? null : look,
        });
    }
    function onFollow(id: ComponentId, follow: boolean) {
        const rec = recs.value.get(id);
        if (rec) setFrame(id, { ...rec, look: follow ? null : clone(sectionLook()) });
    }
    function onReset(id: ComponentId) {
        const b = blocks.value.find(x => x.id === id);
        if (!b) return;
        if (b.kind === 'section') resetSectionLook();
        else setFrame(id, resetFrameRec(section(), b.kind, recs.value.get(id)!));
    }
    return { blocks, toggle, onLook, onFollow, onReset };
}

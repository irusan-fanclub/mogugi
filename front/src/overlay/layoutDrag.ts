import { computed, ref, type Ref } from 'vue';
import { autoAnchor, dockedRect, offsetsFor, rectOf, snapMove, type Guide, type Rect, type Size } from '@/lib/overlayLayout';
import type { ComponentId, OverlayLayout } from '@/lib/overlayProtocol';

export const SNAP_PX = 6;
/** How close a dragged top edge must come to another component's bottom to dock under it. */
export const DOCK_PX = 14;

export interface DragState {
    id: ComponentId;
    pointerId: number | undefined;
    sx: number;
    sy: number;
    base: Rect;
    layout: OverlayLayout;
    l: number;
    t: number;
    moved: boolean;
    guides: Guide[];
    cell: { col: number; row: number } | null;
    /** The component the drag would dock under if released now. */
    dock: ComponentId | null;
}

interface Ctx {
    ids: Ref<readonly ComponentId[]>;
    viewport: Ref<Size>;
    scale: Ref<number>;
    layoutOf(id: ComponentId): OverlayLayout;
    /** 0 for a hidden component, so what is docked under it moves up into its place. */
    heightOf(id: ComponentId): number;
    save(id: ComponentId, layout: OverlayLayout): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Pointer-driven move drags. Nothing is saved until the pointer is released. */
export function useLayoutDrag(ctx: Ctx) {
    const drag = ref<DragState | null>(null);

    const dockOf = (id: ComponentId): ComponentId | null => {
        const d = ctx.layoutOf(id).dock;
        return d && d !== id && ctx.ids.value.includes(d) ? d : null;
    };
    /** The host a component hangs under; a loop of docks leaves every component in it free. */
    function hostOf(id: ComponentId): ComponentId | null {
        const host = dockOf(id);
        const seen = new Set<ComponentId>([id]);
        for (let cur = host; cur; cur = dockOf(cur)) {
            if (seen.has(cur)) return null;
            seen.add(cur);
        }
        return host;
    }
    const isBelow = (id: ComponentId, top: ComponentId) => {
        for (let cur = hostOf(id); cur; cur = hostOf(cur)) if (cur === top) return true;
        return false;
    };
    const followerOf = (id: ComponentId) => ctx.ids.value.find(o => o !== id && hostOf(o) === id) ?? null;

    function placed(id: ComponentId, lay: OverlayLayout): Rect & { clamped: boolean } {
        const host = hostOf(id);
        const h = ctx.heightOf(id);
        return host ? dockedRect(shown(host), lay, h, ctx.viewport.value) : rectOf(lay, h, ctx.viewport.value);
    }

    function shown(id: ComponentId): Rect & { clamped: boolean } {
        const d = drag.value;
        const lay = ctx.layoutOf(id);
        if (d && d.id === id) {
            return { l: d.l, t: d.t, w: d.base.w, h: ctx.heightOf(id), clamped: false };
        }
        return placed(id, lay);
    }

    const rects = computed(() => {
        const out = {} as Record<ComponentId, Rect & { clamped: boolean }>;
        for (const id of ctx.ids.value) out[id] = shown(id);
        return out;
    });

    // What hangs under the dragged component moves with it, so it is no snap target.
    const othersOf = (id: ComponentId) => ctx.ids.value
        .filter(o => o !== id && ctx.layoutOf(o).enabled && !isBelow(o, id))
        .map(o => ({ id: o, r: shown(o) }));

    function start(id: ComponentId, e: { clientX: number; clientY: number; pointerId?: number }) {
        const layout = ctx.layoutOf(id);
        const base = shown(id);
        drag.value = {
            id, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, base, layout,
            l: base.l, t: base.t, moved: false, guides: [], cell: null, dock: null,
        };
    }

    const mine = (d: DragState, e: { pointerId?: number }) =>
        d.pointerId === undefined || e.pointerId === undefined || d.pointerId === e.pointerId;

    function dockTarget(d: DragState, raw: Rect, others: { id: ComponentId; r: Rect }[]) {
        let best: { id: ComponentId; r: Rect; diff: number } | null = null;
        for (const o of others) {
            const diff = Math.abs(raw.t - (o.r.t + o.r.h));
            const overlaps = raw.l < o.r.l + o.r.w && raw.l + raw.w > o.r.l;
            const taken = followerOf(o.id);
            if (diff < DOCK_PX && overlaps && (!taken || taken === d.id) && (!best || diff < best.diff)) best = { ...o, diff };
        }
        return best;
    }

    function move(e: { clientX: number; clientY: number; pointerId?: number; altKey?: boolean }) {
        const d = drag.value;
        if (!d || !mine(d, e)) return;
        const s = ctx.scale.value;
        const dx = (e.clientX - d.sx) / s;
        const dy = (e.clientY - d.sy) / s;
        const vp = ctx.viewport.value;
        const others = e.altKey ? [] : othersOf(d.id);
        d.moved = true;
        const { w, h } = d.base;
        const raw: Rect = { l: clamp(d.base.l + dx, 0, Math.max(0, vp.w - w)), t: clamp(d.base.t + dy, 0, Math.max(0, vp.h - h)), w, h };
        const host = dockTarget(d, raw, others);
        const snapped = e.altKey ? { l: raw.l, t: raw.t, guides: [] as Guide[] } : snapMove(raw, others.map(o => o.r), vp, SNAP_PX);
        d.l = snapped.l;
        d.t = snapped.t;
        d.guides = snapped.guides;
        d.dock = host?.id ?? null;
        if (host) {
            // Docked: the top edge is the host's bottom, whatever else snapped vertically.
            d.t = host.r.t + host.r.h;
            d.guides = [...snapped.guides.filter(g => g.x1 === g.x2), {
                x1: Math.min(d.l, host.r.l), y1: d.t, x2: Math.max(d.l + w, host.r.l + host.r.w), y2: d.t, centre: false,
            }];
        }
        const cx = d.l + w / 2;
        const cy = d.t + h / 2;
        d.cell = { col: cx < vp.w / 3 ? 0 : cx < (vp.w * 2) / 3 ? 1 : 2, row: cy < vp.h / 3 ? 0 : cy < (vp.h * 2) / 3 ? 1 : 2 };
    }

    function free(id: ComponentId, r: Rect): OverlayLayout {
        const vp = ctx.viewport.value;
        const anchor = autoAnchor(r.l + r.w / 2, r.t + r.h / 2, vp);
        const o = offsetsFor(r, anchor, vp);
        return { ...ctx.layoutOf(id), anchor, x: o.x, y: o.y, dock: '' };
    }

    function end(e: { pointerId?: number }) {
        const d = drag.value;
        if (!d || !mine(d, e)) return;
        drag.value = null;
        if (!d.moved) return;
        if (d.dock) {
            ctx.save(d.id, { ...d.layout, dock: d.dock, x: Math.round(d.l - shown(d.dock).l), y: 0 });
            return;
        }
        ctx.save(d.id, free(d.id, { l: d.l, t: d.t, w: d.base.w, h: d.base.h }));
    }

    /** Detaches a docked component where it is now. */
    function undock(id: ComponentId) {
        if (hostOf(id)) ctx.save(id, free(id, shown(id)));
    }

    function cancel() { drag.value = null; }

    return { drag, rects, hostOf, start, move, end, cancel, undock, free };
}

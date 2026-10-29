import { computed, ref, type Ref } from 'vue';
import { autoAnchor, offsetsFor, rectOf, snapMove, snapWidth, type Guide, type Rect, type Size } from '@/lib/overlayLayout';
import type { ComponentId, OverlayLayout } from '@/lib/overlayProtocol';

export const SNAP_PX = 6;
export const MIN_WIDTH = 120;
export const MAX_WIDTH = 800;

export interface DragState {
    id: ComponentId;
    mode: 'move' | 'width';
    pointerId: number | undefined;
    sx: number;
    sy: number;
    base: Rect;
    layout: OverlayLayout;
    l: number;
    t: number;
    width: number;
    moved: boolean;
    guides: Guide[];
    cell: { col: number; row: number } | null;
}

interface Ctx {
    ids: readonly ComponentId[];
    viewport: Ref<Size>;
    scale: Ref<number>;
    layoutOf(id: ComponentId): OverlayLayout;
    heightOf(id: ComponentId): number;
    save(id: ComponentId, layout: OverlayLayout): void;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Pointer-driven move and width drags. Nothing is saved until the pointer is released. */
export function useLayoutDrag(ctx: Ctx) {
    const drag = ref<DragState | null>(null);

    function shown(id: ComponentId): Rect & { clamped: boolean } {
        const d = drag.value;
        const h = ctx.heightOf(id);
        const lay = ctx.layoutOf(id);
        if (d && d.id === id) {
            if (d.mode === 'move') return { l: d.l, t: d.t, w: d.base.w, h, clamped: false };
            return rectOf({ ...lay, width: d.width }, h, ctx.viewport.value);
        }
        return rectOf(lay, h, ctx.viewport.value);
    }

    const rects = computed(() => {
        const out = {} as Record<ComponentId, Rect & { clamped: boolean }>;
        for (const id of ctx.ids) out[id] = shown(id);
        return out;
    });

    const othersOf = (id: ComponentId) => ctx.ids
        .filter(o => o !== id && ctx.layoutOf(o).enabled)
        .map(o => rectOf(ctx.layoutOf(o), ctx.heightOf(o), ctx.viewport.value));

    function start(id: ComponentId, mode: 'move' | 'width', e: { clientX: number; clientY: number; pointerId?: number }) {
        const layout = ctx.layoutOf(id);
        const base = rectOf(layout, ctx.heightOf(id), ctx.viewport.value);
        drag.value = {
            id, mode, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, base, layout,
            l: base.l, t: base.t, width: layout.width, moved: false, guides: [], cell: null,
        };
    }

    const mine = (d: DragState, e: { pointerId?: number }) =>
        d.pointerId === undefined || e.pointerId === undefined || d.pointerId === e.pointerId;

    function move(e: { clientX: number; clientY: number; pointerId?: number; altKey?: boolean }) {
        const d = drag.value;
        if (!d || !mine(d, e)) return;
        const s = ctx.scale.value;
        const dx = (e.clientX - d.sx) / s;
        const dy = (e.clientY - d.sy) / s;
        const vp = ctx.viewport.value;
        const others = e.altKey ? [] : othersOf(d.id);
        d.moved = true;
        if (d.mode === 'move') {
            const { w, h } = d.base;
            const raw: Rect = { l: clamp(d.base.l + dx, 0, Math.max(0, vp.w - w)), t: clamp(d.base.t + dy, 0, Math.max(0, vp.h - h)), w, h };
            const snapped = e.altKey ? { l: raw.l, t: raw.t, guides: [] as Guide[] } : snapMove(raw, others, vp, SNAP_PX);
            d.l = snapped.l;
            d.t = snapped.t;
            d.guides = snapped.guides;
            const cx = d.l + w / 2;
            const cy = d.t + h / 2;
            d.cell = { col: cx < vp.w / 3 ? 0 : cx < (vp.w * 2) / 3 ? 1 : 2, row: cy < vp.h / 3 ? 0 : cy < (vp.h * 2) / 3 ? 1 : 2 };
            return;
        }
        const a = d.layout.anchor;
        const k = a === 'center' ? 2 : 1;
        const sign = a === 'tr' || a === 'br' ? -1 : 1;
        let width = clamp(d.layout.width + sign * k * dx, MIN_WIDTH, MAX_WIDTH);
        let guides: Guide[] = [];
        if (others.length) {
            const r = rectOf({ ...d.layout, width }, d.base.h, vp);
            const edge = sign < 0 ? 'left' : 'right';
            const hit = snapWidth(r, edge, others, SNAP_PX);
            if (hit.guides.length) {
                // A centred component grows on both sides, so the edge moves half as far as the width.
                width = clamp(a === 'center' ? width + 2 * (hit.w - width) : hit.w, MIN_WIDTH, MAX_WIDTH);
                guides = hit.guides;
            }
        }
        d.width = Math.round(width);
        d.guides = guides;
    }

    function end(e: { pointerId?: number }) {
        const d = drag.value;
        if (!d || !mine(d, e)) return;
        drag.value = null;
        if (!d.moved) return;
        if (d.mode === 'width') {
            if (d.width !== d.layout.width) ctx.save(d.id, { ...d.layout, width: d.width });
            return;
        }
        const vp = ctx.viewport.value;
        const r: Rect = { l: d.l, t: d.t, w: d.base.w, h: d.base.h };
        const anchor = autoAnchor(r.l + r.w / 2, r.t + r.h / 2, vp);
        const o = offsetsFor(r, anchor, vp);
        ctx.save(d.id, { ...d.layout, anchor, x: o.x, y: o.y });
    }

    function cancel() { drag.value = null; }

    return { drag, rects, start, move, end, cancel };
}

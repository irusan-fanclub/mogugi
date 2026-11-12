import { ref, type Ref } from 'vue';
import type { Rect, Size } from '@/lib/overlayLayout';
import type { PlaceTarget } from '@/lib/overlayGroups';
import type { ComponentId } from '@/lib/overlayProtocol';
import type { SectionId } from '@/lib/overlaySections';

/** A press must move this far (screen px) before it becomes a tile drag. */
export const TILE_DRAG_PX = 4;
/** A drop this close outside a frame still lands in it. */
export const GROUP_PAD_PX = 16;

export interface TileDragState {
    section: SectionId;
    /** Everything lifted; the first is the grabbed key. */
    keys: string[];
    /** The frame the item is drawn in now. */
    from: ComponentId;
    /** Ghost top-left, pre-scale units. */
    l: number;
    t: number;
    /** The frame a drop would land in; null = a unit frame of its own. */
    over: ComponentId | null;
    /** Bar index among that frame's shown keys without the lifted one; null outside every frame. */
    insertAt: number | null;
    moved: boolean;
    pointerId: number | undefined;
    sx: number;
    sy: number;
    /** Ghost top-left minus the pointer. */
    ox: number;
    oy: number;
}

export interface TileDragCtx {
    /** The shown frames of the section: the section frame, its units and groups. */
    framesOf(section: SectionId): ComponentId[];
    frameRect(id: ComponentId): Rect | null;
    /** Every key of a frame in display order, hidden ones included. */
    keysIn(id: ComponentId): string[];
    /** The tiles drawn in a frame, pre-scale units. */
    tileRects(id: ComponentId): { key: string; r: Rect }[];
    frameOfKey(section: SectionId, key: string): ComponentId;
    /** Top-left of the item's first tile, wherever it is drawn. */
    originOf(section: SectionId, key: string): { l: number; t: number } | null;
    /** The class function when the frame is drawn as a by-member grid, else null. */
    columnsOf(id: ComponentId): ((key: string) => string) | null;
    viewport: Ref<Size>;
    scale: Ref<number>;
    /** `target.index` is a place in the frame's keys without `keys`; `at` is the free top-left. */
    place(section: SectionId, keys: string[], from: ComponentId, target: PlaceTarget | { at: { l: number; t: number } }): void;
}

type Ptr = { clientX: number; clientY: number; pointerId?: number };
export interface DropSpot { frame: ComponentId | null; display: number; index: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const inside = (g: Rect, p: { x: number; y: number }) => {
    const P = GROUP_PAD_PX;
    return p.x >= g.l - P && p.x <= g.l + g.w + P && p.y >= g.t - P && p.y <= g.t + g.h + P;
};

/** Where a drop of `keys` at `p` lands: the smallest frame of the section under it (not `skip`), and the place in it. */
export function dropSpot(ctx: TileDragCtx, section: SectionId, keys: string[], p: { x: number; y: number }, skip?: ComponentId): DropSpot {
    let frame: ComponentId | null = null;
    let area = Infinity;
    for (const id of ctx.framesOf(section)) {
        const g = id === skip ? null : ctx.frameRect(id);
        if (g && inside(g, p) && g.w * g.h < area) { frame = id; area = g.w * g.h; }
    }
    if (frame === null) return { frame, display: 0, index: 0 };
    const boxes = new Map<string, Rect>();
    for (const { key: k, r } of ctx.tileRects(frame)) {
        if (keys.includes(k)) continue;
        const b = boxes.get(k);
        if (!b) { boxes.set(k, { ...r }); continue; }
        const l = Math.min(b.l, r.l), t = Math.min(b.t, r.t);
        boxes.set(k, { l, t, w: Math.max(b.l + b.w, r.l + r.w) - l, h: Math.max(b.t + b.h, r.t + r.h) - t });
    }
    const full = ctx.keysIn(frame).filter(k => !keys.includes(k));
    const shown = full.filter(k => boxes.has(k));
    const cls = ctx.columnsOf(frame);
    if (cls) {
        // One box per class column; the bar goes before the first column whose centre is right of the pointer.
        const cols = new Map<string, { l: number; w: number; first: string }>();
        for (const k of shown) {
            const b = boxes.get(k)!, c = cols.get(cls(k));
            if (!c) cols.set(cls(k), { l: b.l, w: b.w, first: k });
            else { const r = Math.max(c.l + c.w, b.l + b.w); c.l = Math.min(c.l, b.l); c.w = r - c.l; }
        }
        const ordered = [...cols.values()].sort((a, b) => a.l - b.l);
        const at = ordered.findIndex(c => p.x < c.l + c.w / 2);
        const display = at < 0 ? ordered.length : at;
        const index = at >= 0 ? full.indexOf(ordered[at].first)
            : shown.length ? full.indexOf(shown[shown.length - 1]) + 1 : full.length;
        return { frame, display, index };
    }
    let display = shown.findIndex(k => {
        const b = boxes.get(k)!;
        return p.y < b.t || (p.y <= b.t + b.h && p.x < b.l + b.w / 2);
    });
    if (display < 0) display = shown.length;
    // Hidden keys keep their place: insert before the shown key, or right after the last one.
    const index = display < shown.length ? full.indexOf(shown[display])
        : shown.length ? full.indexOf(shown[shown.length - 1]) + 1 : full.length;
    return { frame, display, index };
}

/** Pointer-driven drag of one item's tiles: reorder, pull out, merge back or group with other items. */
export function useTileDrag(ctx: TileDragCtx) {
    const tdrag = ref<TileDragState | null>(null);
    const at = (e: Ptr) => ({ x: e.clientX / ctx.scale.value, y: e.clientY / ctx.scale.value });
    const mine = (d: TileDragState, e: Ptr) =>
        d.pointerId === undefined || e.pointerId === undefined || d.pointerId === e.pointerId;
    // A unit's own frame is not a target: dropping there just moves it.
    const skipOf = (d: TileDragState) => (ctx.keysIn(d.from).length === 1 && d.from !== d.section ? d.from : undefined);

    function startTile(section: SectionId, key: string, e: Ptr) {
        const p = at(e);
        const o = ctx.originOf(section, key) ?? { l: p.x, t: p.y };
        const from = ctx.frameOfKey(section, key);
        const cls = ctx.columnsOf(from);
        const keys = cls ? ctx.keysIn(from).filter(k => k === key || cls(k) === cls(key)) : [key];
        tdrag.value = {
            section, keys, from, l: o.l, t: o.t, over: null, insertAt: null,
            moved: false, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, ox: o.l - p.x, oy: o.t - p.y,
        };
    }

    function moveTile(e: Ptr) {
        const d = tdrag.value;
        if (!d || !mine(d, e)) return;
        if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < TILE_DRAG_PX) return;
        d.moved = true;
        const p = at(e);
        const vp = ctx.viewport.value;
        d.l = clamp(p.x + d.ox, 0, vp.w);
        d.t = clamp(p.y + d.oy, 0, vp.h);
        const s = dropSpot(ctx, d.section, d.keys, p, skipOf(d));
        d.over = s.frame;
        d.insertAt = s.frame ? s.display : null;
    }

    function endTile(e: Ptr) {
        const d = tdrag.value;
        if (!d || !mine(d, e)) return;
        moveTile(e);
        tdrag.value = null;
        if (!d.moved) return;
        const s = dropSpot(ctx, d.section, d.keys, at(e), skipOf(d));
        ctx.place(d.section, d.keys, d.from, s.frame ? { frame: s.frame, index: s.index } : { at: { l: d.l, t: d.t } });
    }

    function cancelTile() { tdrag.value = null; }

    return { tdrag, startTile, moveTile, endTile, cancelTile };
}

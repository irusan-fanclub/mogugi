import type { Anchor, OverlayLayout } from './overlayProtocol';

export interface Size { w: number; h: number }
export interface Rect { l: number; t: number; w: number; h: number }
export interface Guide { x1: number; y1: number; x2: number; y2: number; centre: boolean }

const GUIDE_PAD = 8;

/** Field-wise layout equality; a missing dock or order equals an empty one. */
export function sameLayout(a: OverlayLayout, b: OverlayLayout): boolean {
    const oa = a.order ?? [];
    const ob = b.order ?? [];
    return a.enabled === b.enabled && a.anchor === b.anchor && a.x === b.x && a.y === b.y
        && a.width === b.width && a.maxRows === b.maxRows && (a.dock ?? '') === (b.dock ?? '')
        && oa.length === ob.length && oa.every((id, i) => id === ob[i]);
}

function pointIn(anchor: Anchor, w: number, h: number): { x: number; y: number } {
    return {
        x: anchor === 'tl' || anchor === 'bl' ? 0 : anchor === 'center' ? w / 2 : w,
        y: anchor === 'tl' || anchor === 'tr' ? 0 : anchor === 'center' ? h / 2 : h,
    };
}

/** Where the stored offsets put the component, before it is pulled back inside the window. */
export function unclampedRect(l: OverlayLayout, height: number, vp: Size): Rect {
    const ap = pointIn(l.anchor, vp.w, vp.h);
    const ref = pointIn(l.anchor, l.width, height);
    return { l: ap.x + l.x - ref.x, t: ap.y + l.y - ref.y, w: l.width, h: height };
}

export function rectOf(l: OverlayLayout, height: number, vp: Size): Rect & { clamped: boolean } {
    const { l: rawL, t: rawT } = unclampedRect(l, height, vp);
    const left = Math.min(Math.max(rawL, 0), Math.max(0, vp.w - l.width));
    const top = Math.min(Math.max(rawT, 0), Math.max(0, vp.h - height));
    return { l: left, t: top, w: l.width, h: height, clamped: Math.abs(left - rawL) > 0.5 || Math.abs(top - rawT) > 0.5 };
}

/** A docked component sits right under its host, x pixels from the host's left edge. */
export function dockedRect(host: Rect, l: OverlayLayout, height: number, vp: Size): Rect & { clamped: boolean } {
    const rawL = host.l + l.x;
    const rawT = host.t + host.h;
    const left = Math.min(Math.max(rawL, 0), Math.max(0, vp.w - l.width));
    const top = Math.min(Math.max(rawT, 0), Math.max(0, vp.h - height));
    return { l: left, t: top, w: l.width, h: height, clamped: Math.abs(left - rawL) > 0.5 || Math.abs(top - rawT) > 0.5 };
}

export function offsetsFor(r: Rect, anchor: Anchor, vp: Size): { x: number; y: number } {
    const ap = pointIn(anchor, vp.w, vp.h);
    const ref = pointIn(anchor, r.w, r.h);
    return { x: Math.round(r.l + ref.x - ap.x), y: Math.round(r.t + ref.y - ap.y) };
}

export function autoAnchor(cx: number, cy: number, vp: Size): Anchor {
    const col = cx < vp.w / 3 ? 0 : cx < (vp.w * 2) / 3 ? 1 : 2;
    const row = cy < vp.h / 3 ? 0 : cy < (vp.h * 2) / 3 ? 1 : 2;
    if (col === 1 && row === 1) return 'center';
    if (col !== 1 && row !== 1) return `${row === 0 ? 't' : 'b'}${col === 0 ? 'l' : 'r'}` as Anchor;
    let best: Anchor = 'tl';
    let bestD = Infinity;
    for (const a of ['tl', 'tr', 'bl', 'br'] as const) {
        const p = pointIn(a, vp.w, vp.h);
        const d = Math.hypot(p.x - cx, p.y - cy);
        if (d < bestD) { bestD = d; best = a; }
    }
    return best;
}

interface Hit { diff: number; shift: number; guide: Guide }

function pick(best: Hit | null, hit: Hit): Hit {
    return best === null || hit.diff < best.diff ? hit : best;
}

export function snapMove(r: Rect, others: Rect[], vp: Size, threshold: number): { l: number; t: number; guides: Guide[] } {
    let bestX: Hit | null = null;
    for (const [d, middle] of [[0, false], [r.w / 2, true], [r.w, false]] as const) {
        const v = r.l + d;
        if (middle) {
            const diff = Math.abs(v - vp.w / 2);
            if (diff < threshold) {
                bestX = pick(bestX, { diff, shift: vp.w / 2 - v, guide: { x1: vp.w / 2, y1: 0, x2: vp.w / 2, y2: vp.h, centre: true } });
            }
        }
        for (const o of others) {
            for (const ov of [o.l, o.l + o.w / 2, o.l + o.w]) {
                const diff = Math.abs(v - ov);
                if (diff < threshold) {
                    const y1 = Math.min(r.t, o.t) - GUIDE_PAD;
                    const y2 = Math.max(r.t + r.h, o.t + o.h) + GUIDE_PAD;
                    bestX = pick(bestX, { diff, shift: ov - v, guide: { x1: ov, y1, x2: ov, y2, centre: false } });
                }
            }
        }
    }
    const l = r.l + (bestX?.shift ?? 0);

    let bestY: Hit | null = null;
    for (const [d, middle] of [[0, false], [r.h / 2, true], [r.h, false]] as const) {
        const v = r.t + d;
        if (middle) {
            const diff = Math.abs(v - vp.h / 2);
            if (diff < threshold) {
                bestY = pick(bestY, { diff, shift: vp.h / 2 - v, guide: { x1: 0, y1: vp.h / 2, x2: vp.w, y2: vp.h / 2, centre: true } });
            }
        }
        for (const o of others) {
            for (const ov of [o.t, o.t + o.h / 2, o.t + o.h]) {
                const diff = Math.abs(v - ov);
                if (diff < threshold) {
                    const x1 = Math.min(l, o.l) - GUIDE_PAD;
                    const x2 = Math.max(l + r.w, o.l + o.w) + GUIDE_PAD;
                    bestY = pick(bestY, { diff, shift: ov - v, guide: { x1, y1: ov, x2, y2: ov, centre: false } });
                }
            }
        }
    }
    const t = r.t + (bestY?.shift ?? 0);

    const guides: Guide[] = [];
    if (bestX) guides.push(bestX.guide);
    if (bestY) guides.push(bestY.guide);
    return { l, t, guides };
}

export function snapWidth(r: Rect, edge: 'left' | 'right', others: Rect[], threshold: number): { w: number; guides: Guide[] } {
    const v = edge === 'left' ? r.l : r.l + r.w;
    let best: Hit | null = null;
    for (const o of others) {
        for (const ov of [o.l, o.l + o.w / 2, o.l + o.w]) {
            const diff = Math.abs(v - ov);
            if (diff < threshold) {
                const y1 = Math.min(r.t, o.t) - GUIDE_PAD;
                const y2 = Math.max(r.t + r.h, o.t + o.h) + GUIDE_PAD;
                best = pick(best, { diff, shift: ov - v, guide: { x1: ov, y1, x2: ov, y2, centre: false } });
            }
        }
    }
    if (!best) return { w: r.w, guides: [] };
    return { w: edge === 'left' ? r.w - best.shift : r.w + best.shift, guides: [best.guide] };
}

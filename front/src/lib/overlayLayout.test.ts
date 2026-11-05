import { describe, expect, it } from 'vitest';
import type { Anchor, OverlayLayout } from './overlayProtocol';
import { autoAnchor, offsetsFor, rectOf, sameLayout, snapMove, snapWidth } from './overlayLayout';

const vp = { w: 1280, h: 720 };
const lay = (anchor: Anchor, x: number, y: number, width: number): OverlayLayout =>
    ({ enabled: true, anchor, x, y, width, maxRows: 4 });

describe('rectOf', () => {
    it('places by anchor', () => {
        expect(rectOf(lay('tr', -24, 24, 260), 150, vp)).toMatchObject({ l: 996, t: 24, w: 260, h: 150, clamped: false });
        expect(rectOf(lay('br', -24, -24, 260), 100, vp)).toMatchObject({ l: 996, t: 596 });
        expect(rectOf(lay('center', 0, -170, 320), 100, vp)).toMatchObject({ l: 480, t: 140 });
    });
    it('grows away from the anchor', () => {
        const l = lay('bl', 24, -24, 240);
        const a = rectOf(l, 100, vp), b = rectOf(l, 200, vp);
        expect([a.t, b.t]).toEqual([596, 496]);
        expect(a.t + a.h).toBe(b.t + b.h);
    });
    it('clamps into a small viewport without mutating the layout', () => {
        const l = lay('tl', 600, 24, 260);
        const copy = { ...l };
        const r = rectOf(l, 100, { w: 640, h: 360 });
        expect(r.l).toBe(380);
        expect(r.clamped).toBe(true);
        expect(l).toEqual(copy);
    });
});

describe('offsetsFor', () => {
    it('round-trips with rectOf for every anchor', () => {
        const cases: [Anchor, number, number][] = [
            ['tl', 24, 24], ['tr', -24, 24], ['bl', 24, -24], ['br', -24, -24], ['center', 10, -170],
        ];
        for (const [a, x, y] of cases) {
            const r = rectOf(lay(a, x, y, 260), 120, vp);
            expect(offsetsFor(r, a, vp)).toEqual({ x, y });
        }
    });
});

describe('autoAnchor', () => {
    it('picks corners, centre and nearest corner for edge cells', () => {
        expect(autoAnchor(100, 100, vp)).toBe('tl');
        expect(autoAnchor(1200, 650, vp)).toBe('br');
        expect(autoAnchor(640, 360, vp)).toBe('center');
        expect(autoAnchor(640, 50, vp)).toBe('tl');
        expect(autoAnchor(1200, 360, vp)).toBe('tr');
        expect(autoAnchor(1200, 500, vp)).toBe('br');
    });
});

describe('snapMove', () => {
    const r = (l: number, t: number, w = 200, h = 100) => ({ l, t, w, h });
    it('snaps the centre line to the viewport centre', () => {
        const out = snapMove(r(544, 100), [], vp, 6);
        expect(out.l).toBe(540);
        expect(out.guides.some(g => g.centre)).toBe(true);
    });
    it('does not snap beyond the threshold', () => {
        const out = snapMove(r(547, 100), [], vp, 6);
        expect(out.l).toBe(547);
        expect(out.guides).toEqual([]);
    });
    it('aligns to another component and spans both in the guide', () => {
        const other = r(300, 400);
        const out = snapMove(r(305, 50), [other], vp, 6);
        expect(out.l).toBe(300);
        const g = out.guides.find(g => !g.centre)!;
        expect(g.x1).toBe(300);
        expect(g.y1).toBeLessThanOrEqual(50);
        expect(g.y2).toBeGreaterThanOrEqual(500);
    });
});

describe('snapWidth', () => {
    const o = { l: 100, t: 300, w: 200, h: 100 };
    it('snaps the right edge to another component and reports the width', () => {
        const out = snapWidth({ l: 100, t: 50, w: 197, h: 80 }, 'right', [o], 6);
        expect(out.w).toBe(200);
        expect(out.guides.length).toBe(1);
    });
    it('keeps the right edge fixed when dragging the left edge', () => {
        const out = snapWidth({ l: 103, t: 50, w: 197, h: 80 }, 'left', [o], 6);
        expect(out.w).toBe(200);
    });
    it('leaves the width alone when nothing is near', () => {
        expect(snapWidth({ l: 100, t: 50, w: 250, h: 80 }, 'right', [o], 6)).toEqual({ w: 250, guides: [] });
    });
});

describe('sameLayout', () => {
    const base = lay('tl', 1, 2, 260);
    it('treats a missing order and an empty one as equal', () => {
        expect(sameLayout(base, { ...base, order: [] })).toBe(true);
        expect(sameLayout({ ...base, dock: '' }, base)).toBe(true);
    });
    it('compares order element-wise', () => {
        expect(sameLayout({ ...base, order: ['a', 'b'] }, { ...base, order: ['a', 'b'] })).toBe(true);
        expect(sameLayout({ ...base, order: ['a', 'b'] }, { ...base, order: ['b', 'a'] })).toBe(false);
        expect(sameLayout({ ...base, order: ['a'] }, base)).toBe(false);
    });
});

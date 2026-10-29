import { describe, expect, it } from 'vitest';
import { COMPONENTS, layoutOf } from './overlayComponents';
import { rectOf } from './overlayLayout';
import type { OverlayLayout } from './overlayProtocol';

describe('layoutOf', () => {
    it('returns the default for a missing entry', () => {
        expect(layoutOf('cooldown', {})).toEqual({ enabled: true, anchor: 'bl', x: 24, y: -24, width: 240, maxRows: 6 });
        expect(layoutOf('alerts', undefined)).toEqual({ enabled: true, anchor: 'center', x: 0, y: -170, width: 320, maxRows: 4 });
    });
    it('returns the stored layout when present', () => {
        const stored: OverlayLayout = { enabled: false, anchor: 'br', x: 5, y: 6, width: 100, maxRows: 2 };
        expect(layoutOf('dps', { dps: stored })).toEqual(stored);
    });
});

describe('COMPONENTS', () => {
    it('lists the four components with their names and defaults', () => {
        expect(COMPONENTS.map(c => [c.id, c.name])).toEqual([
            ['dps', 'DPS'], ['cc', 'CC 監測'], ['cooldown', '技能冷卻'], ['alerts', '提醒'],
        ]);
        expect(COMPONENTS[0].defaultLayout).toEqual({ enabled: true, anchor: 'tr', x: -24, y: 24, width: 260, maxRows: 8 });
        expect(COMPONENTS[1].defaultLayout).toEqual({ enabled: true, anchor: 'tl', x: 24, y: 24, width: 300, maxRows: 8 });
    });
    it('default layouts do not overlap in 1280x720 (height 200)', () => {
        const rects = COMPONENTS.map(c => rectOf(c.defaultLayout, 200, { w: 1280, h: 720 }));
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i], b = rects[j];
                const overlap = a.l < b.l + b.w && b.l < a.l + a.w && a.t < b.t + b.h && b.t < a.t + a.h;
                expect(overlap, `${COMPONENTS[i].id} vs ${COMPONENTS[j].id}`).toBe(false);
            }
        }
    });
});

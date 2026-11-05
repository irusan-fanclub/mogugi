import { describe, it, expect, vi } from 'vitest';
import { ref } from 'vue';
import type { Rect } from '@/lib/overlayLayout';
import { useTileDrag, type TileDragCtx } from './tileDrag';

// Section frame at (100,100) 300x60; four keys shown in one row, 40px apart. '9' is hidden (no tiles).
// Unit frame 'ccBoss-4' at (600,300); group 'ccBoss-g1' at (600,500) holds '5' and '6'.
const SECTION: Rect = { l: 100, t: 100, w: 300, h: 60 };
const UNIT: Rect = { l: 600, t: 300, w: 120, h: 60 };
const GROUP: Rect = { l: 600, t: 500, w: 160, h: 60 };
const box = (l: number, t = 110): Rect => ({ l, t, w: 36, h: 40 });
const TILES: Record<string, { key: string; r: Rect }[]> = {
    'ccBoss': [{ key: '1', r: box(110) }, { key: '2', r: box(150) }, { key: '3', r: box(190) }],
    'ccBoss-4': [{ key: '4', r: box(610, 310) }],
    'ccBoss-g1': [{ key: '5', r: box(610, 510) }, { key: '6', r: box(650, 510) }],
};
const KEYS: Record<string, string[]> = { 'ccBoss': ['1', '9', '2', '3', '4', '5', '6'], 'ccBoss-4': ['4'], 'ccBoss-g1': ['5', '6'] };
const RECT: Record<string, Rect> = { 'ccBoss': SECTION, 'ccBoss-4': UNIT, 'ccBoss-g1': GROUP };
const FRAME_OF: Record<string, string> = { 4: 'ccBoss-4', 5: 'ccBoss-g1', 6: 'ccBoss-g1' };

function setup(scale = 1) {
    const place = vi.fn();
    const ctx: TileDragCtx = {
        framesOf: () => Object.keys(RECT),
        frameRect: id => RECT[id] ?? null,
        keysIn: id => KEYS[id] ?? [],
        // The section frame does not draw the pulled-out keys.
        tileRects: id => TILES[id] ?? [],
        frameOfKey: (_s, k) => FRAME_OF[k] ?? 'ccBoss',
        originOf: (_s, k) => {
            const f = FRAME_OF[k] ?? 'ccBoss';
            const r = TILES[f].find(x => x.key === k)!.r;
            return { l: r.l, t: r.t };
        },
        viewport: ref({ w: 1280, h: 720 }), scale: ref(scale), place,
    };
    return { d: useTileDrag(ctx), place };
}
const ptr = (x: number, y: number) => ({ clientX: x, clientY: y, pointerId: 1 });

describe('useTileDrag', () => {
    it('dropping inside the section before the second shown key reorders; a hidden key keeps its place', () => {
        const { d, place } = setup();
        d.startTile('ccBoss', '3', ptr(200, 120));
        d.moveTile(ptr(160, 125));
        expect(d.tdrag.value).toMatchObject({ key: '3', from: 'ccBoss', over: 'ccBoss', insertAt: 1 });
        d.endTile(ptr(160, 125));
        // Full order without '3': 1, 9, [here], 2, 4, 5, 6.
        expect(place).toHaveBeenCalledWith('ccBoss', ['3'], 'ccBoss', { frame: 'ccBoss', index: 2 });
        expect(d.tdrag.value).toBeNull();
    });

    it('a drop in the 16px edge still counts as inside', () => {
        const { d, place } = setup();
        d.startTile('ccBoss', '1', ptr(120, 120));
        d.endTile(ptr(240, 100 + 60 + 15));
        expect(place.mock.calls[0][3]).toMatchObject({ frame: 'ccBoss' });
    });

    it('dropping outside every frame pulls it out at the ghost top-left', () => {
        const { d, place } = setup();
        d.startTile('ccBoss', '2', ptr(160, 120));
        d.moveTile(ptr(500, 650));
        expect(d.tdrag.value).toMatchObject({ over: null, insertAt: null, l: 490, t: 640 });
        d.endTile(ptr(500, 650));
        expect(place).toHaveBeenCalledWith('ccBoss', ['2'], 'ccBoss', { at: { l: 490, t: 640 } });
    });

    it('dropping on a unit of the same section groups with it', () => {
        const { d, place } = setup();
        d.startTile('ccBoss', '1', ptr(120, 120));
        d.moveTile(ptr(660, 330));
        expect(d.tdrag.value).toMatchObject({ over: 'ccBoss-4', insertAt: 1 });
        d.endTile(ptr(660, 330));
        expect(place).toHaveBeenCalledWith('ccBoss', ['1'], 'ccBoss', { frame: 'ccBoss-4', index: 1 });
    });

    it('dropping on a group joins it at the bar', () => {
        const { d, place } = setup();
        d.startTile('ccBoss', '1', ptr(120, 120));
        d.endTile(ptr(655, 530));
        expect(place).toHaveBeenCalledWith('ccBoss', ['1'], 'ccBoss', { frame: 'ccBoss-g1', index: 1 });
    });

    it('a unit dropped on its own frame moves instead of merging into itself', () => {
        const { d, place } = setup();
        d.startTile('ccBoss', '4', ptr(620, 320));
        d.endTile(ptr(640, 340));
        expect(place).toHaveBeenCalledWith('ccBoss', ['4'], 'ccBoss-4', { at: { l: 630, t: 330 } });
    });

    it('from a group, a drop inside the section merges back', () => {
        const { d, place } = setup();
        d.startTile('ccBoss', '5', ptr(620, 520));
        d.endTile(ptr(200, 130));
        expect(place).toHaveBeenCalledWith('ccBoss', ['5'], 'ccBoss-g1', { frame: 'ccBoss', index: 3 });
    });

    it('a press without moving 4px places nothing', () => {
        const { d, place } = setup();
        d.startTile('ccBoss', '2', ptr(160, 120));
        d.moveTile(ptr(162, 122));
        expect(d.tdrag.value?.insertAt).toBeNull();
        d.endTile(ptr(162, 122));
        expect(place).not.toHaveBeenCalled();
        expect(d.tdrag.value).toBeNull();
    });

    it('cancel drops the drag; another pointer is ignored', () => {
        const { d, place } = setup();
        d.startTile('ccBoss', '2', ptr(160, 120));
        d.moveTile({ clientX: 600, clientY: 600, pointerId: 2 });
        expect(d.tdrag.value?.l).toBe(150);
        d.cancelTile();
        d.endTile(ptr(600, 600));
        expect(place).not.toHaveBeenCalled();
    });

    it('works in pre-scale units', () => {
        const { d, place } = setup(2);
        d.startTile('ccBoss', '1', ptr(240, 240));
        d.endTile(ptr(1000, 1300));
        expect(place).toHaveBeenCalledWith('ccBoss', ['1'], 'ccBoss', { at: { l: 490, t: 640 } });
    });
});

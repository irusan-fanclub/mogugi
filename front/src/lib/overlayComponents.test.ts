import { describe, expect, it } from 'vitest';
import { componentsOf, defaultLayoutOf, layoutOf } from './overlayComponents';
import { defaultOverlaySettings } from './overlaySettings';
import { dockedRect, rectOf, type Rect } from './overlayLayout';
import type { OverlayLayout } from './overlayProtocol';

const UNIT: OverlayLayout = { enabled: true, anchor: 'tl', x: 0, y: 0, width: 120, maxRows: 1 };

describe('layoutOf', () => {
    it('returns the default for a missing entry', () => {
        expect(layoutOf('cooldown', {})).toEqual({
            enabled: true, anchor: 'bl', x: 26, y: -38, width: 149, maxRows: 6, order: ['59005', '59143', '59123'],
        });
        expect(layoutOf('alerts', undefined)).toEqual({ enabled: false, anchor: 'tr', x: -765, y: 33, width: 320, maxRows: 4 });
    });
    it('returns the stored layout when present', () => {
        const stored: OverlayLayout = { enabled: false, anchor: 'br', x: 5, y: 6, width: 100, maxRows: 2 };
        expect(layoutOf('dps', { dps: stored })).toEqual(stored);
    });
    it('a unit defaults to a small top-left frame', () => {
        expect(defaultLayoutOf('ccBoss-1164')).toEqual(UNIT);
        expect(defaultLayoutOf('cooldown-59005')).toEqual(UNIT);
    });
    it('the BOSS panel takes the old single CC layout, with its own row count', () => {
        const old: OverlayLayout = { enabled: false, anchor: 'br', x: 5, y: 6, width: 100, maxRows: 7 };
        expect(layoutOf('ccBoss', { cc: old })).toEqual({ ...old, maxRows: 1 });
        expect(layoutOf('ccSelf', { cc: old })).toEqual(defaultLayoutOf('ccSelf'));
    });
});

describe('componentsOf', () => {
    const S = defaultOverlaySettings();
    const COMPONENTS = componentsOf(S, {});

    it('lists the fixed sections in order with their names', () => {
        expect(COMPONENTS.map(c => [c.id, c.name, c.kind])).toEqual([
            ['dps', '簡易戰鬥資訊', 'dps'], ['ccBoss', 'BOSS CC', 'section'], ['ccSelf', '自己 CC', 'section'],
            ['ccParty', '隊伍 CC', 'section'], ['cooldown', '技能冷卻', 'section'], ['burst', '爆發提示', 'section'],
            ['misc', '雜項', 'section'], ['alerts', '提醒', 'alerts'],
        ]);
        expect(COMPONENTS[1]).toMatchObject({ section: 'ccBoss' });
        expect(COMPONENTS[0].defaultLayout).toEqual({ enabled: true, anchor: 'tr', x: -24, y: 24, width: 355, maxRows: 8 });
        expect(COMPONENTS[1].defaultLayout).toEqual({ enabled: false, anchor: 'tl', x: 249, y: 107, width: 300, maxRows: 1 });
        expect(COMPONENTS[2].defaultLayout.dock).toBeUndefined();
        expect(COMPONENTS[4].defaultLayout).toMatchObject({ anchor: 'bl', x: 26, y: -38, width: 149 });
        expect(COMPONENTS[5].defaultLayout).toMatchObject({ enabled: false, anchor: 'tr', x: -966, y: 122, width: 120, maxRows: 1 });
        expect(COMPONENTS[6].defaultLayout).toEqual({ enabled: true, anchor: 'center', x: 0, y: -309, width: 123, maxRows: 1 });
    });

    it('adds a unit per item with a stored unit layout; orphans are skipped', () => {
        const l = componentsOf(S, { 'ccBoss-1164': UNIT, 'cooldown-59143': UNIT, 'ccBoss-999': UNIT, 'nope-1': UNIT });
        const units = l.filter(c => c.kind === 'unit');
        expect(units.map(c => [c.id, c.section, c.key])).toEqual([
            ['ccBoss-1164', 'ccBoss', '1164'], ['cooldown-59143', 'cooldown', '59143'],
        ]);
        expect(units[0].name).toBe('BOSS CC・減物保');
        expect(units[0].defaultLayout).toEqual(UNIT);
        expect(l.slice(0, 8).map(c => c.id)).toEqual(COMPONENTS.map(c => c.id));
    });

    it('a unit title takes the item name from the namer', () => {
        const l = componentsOf(S, { 'ccBoss-1164': UNIT }, (_s, key) => `n${key}`);
        expect(l.at(-1)!.name).toBe('BOSS CC・n1164');
    });

    // One-row panels are about 50px tall, an alert row 30px, the rest 200px.
    it('enabled default layouts do not overlap in 1280x720', () => {
        const H: Record<string, number> = { ccBoss: 50, ccSelf: 50, ccParty: 50, burst: 50, cooldown: 50, misc: 50, alerts: 30 };
        const h = (id: string) => H[id] ?? 200;
        const vp = { w: 1280, h: 720 };
        const byId: Record<string, Rect> = {};
        // Disabled sections are hidden by default, so they may share a spot.
        const shown = COMPONENTS.filter(c => c.defaultLayout.enabled);
        for (const c of shown) {
            const l = c.defaultLayout;
            byId[c.id] = l.dock ? dockedRect(byId[l.dock], l, h(c.id), vp) : rectOf(l, h(c.id), vp);
        }
        const rects = shown.map(c => byId[c.id]);
        for (let i = 0; i < rects.length; i++) {
            for (let j = i + 1; j < rects.length; j++) {
                const a = rects[i], b = rects[j];
                const overlap = a.l < b.l + b.w && b.l < a.l + a.w && a.t < b.t + b.h && b.t < a.t + a.h;
                expect(overlap, `${shown[i].id} vs ${shown[j].id}`).toBe(false);
            }
        }
    });
});

describe('unknown id layout', () => {
    it('an unknown id starts in the centre of the screen', () => {
        expect(defaultLayoutOf('w7')).toEqual({ enabled: true, anchor: 'center', x: 0, y: 0, width: 260, maxRows: 6 });
        expect(layoutOf('w7', {})).toEqual(defaultLayoutOf('w7'));
    });
});

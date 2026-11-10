import { describe, expect, it } from 'vitest';
import { defaultLayoutOf, layoutOf } from './overlayComponents';
import type { OverlayLayout } from './overlayProtocol';
import { defaultOverlaySettings, type OverlaySettings } from './overlaySettings';
import type { SharePayload } from './overlayShareCodec';
import {
    applyOps, mergeImport, REGIONS, regionOfLayoutId, regionSummary, sanitizeLayouts, undoOps,
    type Layouts, type RegionId, type RegionPick,
} from './overlayShareMerge';

const lay = (o: Partial<OverlayLayout> = {}): OverlayLayout =>
    ({ enabled: true, anchor: 'tl', x: 10, y: 10, width: 300, maxRows: 2, ...o });

function sentSettings(): OverlaySettings {
    const s = defaultOverlaySettings();
    s.scale = 150;
    s.general = { ...s.general, bg: { color: '#123456', alpha: 50 } };
    s.ccBoss.items = s.ccBoss.items.slice(0, 1);
    s.ccSelf.items = s.ccSelf.items.slice(0, 1);
    s.rules = s.rules.slice(0, 2);
    s.voice = { ...s.voice, rate: 2, voiceName: '' };
    return s;
}
const payload = (layouts: Record<string, unknown> = {}, settings = sentSettings()): SharePayload =>
    ({ settingsV: 2, settings, layouts });
const only = (r: RegionId, position = false): Partial<Record<RegionId, RegionPick>> => ({ [r]: { import: true, position } });
const allIn = (position: boolean) =>
    Object.fromEntries(REGIONS.map(r => [r.id, { import: true, position: position && r.hasPosition }]));
const sortedKeys = (o: object) => Object.keys(o).sort();

describe('regionOfLayoutId', () => {
    it('maps ids exactly', () => {
        expect(regionOfLayoutId('ccSelf-12')).toBe('ccSelf');
        expect(regionOfLayoutId('ccBoss-g3')).toBe('ccBoss');
        expect(regionOfLayoutId('cooldown-59005')).toBe('cooldown');
        expect(regionOfLayoutId('dps')).toBe('dps');
        expect(regionOfLayoutId('alerts')).toBe('alerts');
        expect(regionOfLayoutId('misc')).toBe('misc');
        expect(regionOfLayoutId('cc')).toBeNull();
        expect(regionOfLayoutId('ccSelfx')).toBeNull();
        expect(regionOfLayoutId('ccSelf-')).toBeNull();
        expect(regionOfLayoutId('foo')).toBeNull();
    });
});

describe('sanitizeLayouts', () => {
    it('drops unusable entries and repairs order and dock', () => {
        const out = sanitizeLayouts({
            'bad id': lay(),
            badAnchor: lay({ anchor: 'zz' as never }),
            narrow: lay({ width: 100 }),
            noRows: lay({ maxRows: 0 }),
            str: 'x',
            nul: null,
            arr: [],
            ok: lay({ dock: 'a b', order: ['1', 'bad id', ...Array.from({ length: 80 }, (_, i) => String(i + 2))] }),
            ok2: lay({ dock: 'ccBoss' }),
        });
        expect(sortedKeys(out)).toEqual(['ok', 'ok2']);
        expect(out.ok!.dock).toBe('');
        expect(out.ok!.order).toHaveLength(64);
        expect(out.ok!.order).not.toContain('bad id');
        expect(out.ok2!.dock).toBe('ccBoss');
        expect(out.ok2!.order).toBeUndefined();
    });

    it('skips prototype-polluting ids', () => {
        const raw = JSON.parse(`{"__proto__":${JSON.stringify(lay())},"constructor":${JSON.stringify(lay())},"prototype":${JSON.stringify(lay())},"ok":${JSON.stringify(lay())}}`);
        expect(sortedKeys(sanitizeLayouts(raw))).toEqual(['ok']);
    });
});

describe('mergeImport', () => {
    it('leaves untouched regions alone', () => {
        const own = defaultOverlaySettings();
        const ownL: Layouts = { ccSelf: lay(), 'ccSelf-5': lay(), dps: lay() };
        const r = mergeImport(own, ownL, payload({ ccBoss: lay({ x: 99 }), 'ccBoss-7': lay() }), only('ccBoss', true));
        const expected = structuredClone(own);
        expected.ccBoss = sentSettings().ccBoss;
        expect(r.settings).toEqual(expected);
        for (const id of [...Object.keys(r.saves), ...r.removes]) expect(regionOfLayoutId(id)).toBe('ccBoss');
    });

    it('import only keeps own position and units', () => {
        const own = defaultOverlaySettings();
        const ownL: Layouts = { ccSelf: lay({ x: 10, y: 10 }), 'ccSelf-5': lay({ x: 7 }) };
        const sent = {
            ccSelf: lay({ anchor: 'br', x: -5, y: -5, enabled: false, order: ['3', '1'] }),
            'ccSelf-9': lay(),
        };
        const r = mergeImport(own, ownL, payload(sent), only('ccSelf'));
        expect(r.saves.ccSelf).toEqual({ ...lay({ x: 10, y: 10 }), enabled: false, order: ['3', '1'] });
        expect(r.saves['ccSelf-9']).toBeUndefined();
        expect(r.removes).toEqual([]);
        expect(r.settings.ccSelf).toEqual(sentSettings().ccSelf);
    });

    it('import only on an uncustomised region keeps the effective position', () => {
        const own = defaultOverlaySettings();
        const r = mergeImport(own, {}, payload({}), only('ccBoss'));
        const def = defaultLayoutOf('ccBoss');
        expect(r.saves.ccBoss).toEqual({ ...def, enabled: def.enabled });
        expect(r.saves.ccBoss.x).toBe(def.x);

        const legacy = lay({ anchor: 'tr', x: -40, y: 60, width: 250, maxRows: 5 });
        const r2 = mergeImport(own, { cc: legacy }, payload({ ccBoss: lay({ enabled: false, x: 1 }) }), only('ccBoss'));
        expect(r2.saves.ccBoss).toMatchObject({ anchor: 'tr', x: -40, y: 60, width: 250, maxRows: def.maxRows, enabled: false });
        expect(r2.removes).toEqual([]);
    });

    it('import with position replaces the whole region', () => {
        const own = defaultOverlaySettings();
        const ownL: Layouts = { ccBoss: lay(), 'ccBoss-g1': lay(), cc: lay(), ccSelf: lay() };
        const sent = { ccBoss: lay({ x: 77 }), 'ccBoss-7': lay({ x: 5 }) };
        const r = mergeImport(own, ownL, payload(sent), only('ccBoss', true));
        expect([...r.removes].sort()).toEqual(['cc', 'ccBoss-g1']);
        expect(r.saves.ccBoss).toEqual(lay({ x: 77 }));
        expect(r.saves['ccBoss-7']).toEqual(lay({ x: 5 }));
        expect(sortedKeys(r.saves)).toEqual(['ccBoss', 'ccBoss-7']);
    });

    it('with position, an unstored sender main frame drops own record; legacy cc is kept as ccBoss', () => {
        const r = mergeImport(defaultOverlaySettings(), { ccBoss: lay() }, payload({}), only('ccBoss', true));
        expect(r.saves).toEqual({});
        expect(r.removes).toEqual(['ccBoss']);
        const legacy = lay({ anchor: 'tr', x: -9 });
        const r2 = mergeImport(defaultOverlaySettings(), { ccBoss: lay() }, payload({ cc: legacy }), only('ccBoss', true));
        expect(r2.saves.ccBoss).toEqual({ ...legacy, maxRows: defaultLayoutOf('ccBoss').maxRows });
    });

    it('undocks a frame whose host is missing', () => {
        const own = defaultOverlaySettings();
        const sent = { ccSelf: lay({ dock: 'ccBoss-g2', x: 30, y: 4, anchor: 'br' }) };
        const r = mergeImport(own, {}, payload(sent), only('ccSelf', true));
        expect(r.saves.ccSelf).toMatchObject({ dock: '', anchor: 'center', x: 0, y: 0, width: 300, maxRows: 2 });
    });

    it('undocks own frames docked under a removed one', () => {
        const own = defaultOverlaySettings();
        const ownL: Layouts = { ccBoss: lay(), 'ccBoss-g1': lay(), misc: lay({ dock: 'ccBoss-g1', x: 12 }) };
        const r = mergeImport(own, ownL, payload({ ccBoss: lay() }), only('ccBoss', true));
        expect(r.removes).toEqual(['ccBoss-g1']);
        expect(r.saves.misc).toMatchObject({ dock: '', anchor: 'center', x: 0, y: 0 });
    });

    it('keeps a dock onto a fixed main frame without a record', () => {
        const ownL: Layouts = { 'ccSelf-3': lay({ dock: 'ccBoss' }) };
        const r = mergeImport(defaultOverlaySettings(), ownL, payload({}), only('general'));
        expect(r.saves).toEqual({});
    });

    it('breaks a dock cycle at exactly one frame', () => {
        const own = defaultOverlaySettings();
        const ownL: Layouts = { ccSelf: lay({ dock: 'ccBoss' }), ccBoss: lay() };
        const r = mergeImport(own, ownL, payload({ ccBoss: lay({ dock: 'ccSelf' }) }), only('ccBoss', true));
        const after = applyOps(ownL, r);
        const undocked = ['ccBoss', 'ccSelf'].filter(id => after[id]!.dock === '' && after[id]!.x === 0 && after[id]!.anchor === 'center');
        expect(undocked).toEqual(['ccBoss']);
        expect(after.ccSelf!.dock).toBe('ccBoss');
    });

    it('identity: re-importing own export changes nothing', () => {
        const own = sentSettings();
        own.voice.voiceName = 'Microsoft Hanhan';
        const ownL: Layouts = {
            dps: lay(), ccBoss: lay({ order: ['1'] }), 'ccBoss-g1': lay({ order: ['4', '5'] }),
            'ccSelf-5': lay({ dock: 'ccBoss-g1', x: 3 }), cooldown: lay({ dock: '' }), alerts: lay(),
        };
        const sent = payload(structuredClone(ownL), structuredClone(own));
        sent.settings.voice.voiceName = '';
        const r = mergeImport(own, ownL, sent, allIn(true));
        expect(r.saves).toEqual({});
        expect(r.removes).toEqual([]);
        expect(r.settings).toEqual(own);
    });

    it('identity: a legacy cc-only own layout keeps its effective BOSS position', () => {
        const own = sentSettings();
        const ownL: Layouts = { cc: lay({ anchor: 'tr', x: -40, y: 60, width: 250 }) };
        // Built the way encodeShare does: cc dropped, replaced by the effective ccBoss.
        const sent = payload({ ccBoss: layoutOf('ccBoss', ownL) }, structuredClone(own));
        const r = mergeImport(own, ownL, sent, allIn(true));
        const after = applyOps(ownL, r);
        expect(layoutOf('ccBoss', after)).toEqual(layoutOf('ccBoss', ownL));
        expect(r.settings).toEqual(own);
    });

    it('alerts keeps own voiceName and replaces rules', () => {
        const own = defaultOverlaySettings();
        own.voice.voiceName = 'Microsoft Hanhan';
        const r = mergeImport(own, {}, payload(), only('alerts'));
        expect(r.settings.voice).toEqual({ ...sentSettings().voice, voiceName: 'Microsoft Hanhan' });
        expect(r.settings.rules).toHaveLength(2);
        expect(r.settings.alerts).toEqual(sentSettings().alerts);
    });

    it('general maps to general and scale only', () => {
        const own = defaultOverlaySettings();
        const r = mergeImport(own, {}, payload(), only('general'));
        expect(r.settings.scale).toBe(150);
        expect(r.settings.general.bg.color).toBe('#123456');
        expect(r.saves).toEqual({});
    });

    it('never lists an id in both saves and removes', () => {
        const ownL: Layouts = { ccBoss: lay(), 'ccBoss-7': lay({ x: 1 }) };
        const r = mergeImport(defaultOverlaySettings(), ownL, payload({ ccBoss: lay(), 'ccBoss-7': lay({ x: 2 }) }), only('ccBoss', true));
        for (const id of r.removes) expect(r.saves[id]).toBeUndefined();
        expect(sortedKeys(r.saves)).toEqual(['ccBoss-7']);
    });
});

describe('undoOps / applyOps', () => {
    it('restores the layouts from before an import', () => {
        const before: Layouts = { ccBoss: lay(), 'ccBoss-g1': lay({ order: ['1', '2'] }), ccSelf: lay({ dock: 'ccBoss-g1' }), dps: lay() };
        const r = mergeImport(defaultOverlaySettings(), before, payload({ ccBoss: lay({ x: 50 }), 'ccBoss-7': lay() }), only('ccBoss', true));
        const after = applyOps(before, r);
        expect(after['ccBoss-7']).toBeDefined();
        expect(after['ccBoss-g1']).toBeUndefined();
        expect(after.ccSelf!.dock).toBe('');
        expect(applyOps(after, undoOps(before, after))).toEqual(before);
    });
});

describe('regionSummary', () => {
    it('describes each region', () => {
        const p = payload();
        expect(regionSummary(p, 'general')).toBe('背景、狀態顏色、整體縮放');
        expect(regionSummary(p, 'ccBoss')).toBe('1 個圖示');
        expect(regionSummary(p, 'cooldown')).toBe(`${p.settings.cooldown.items.length} 個技能`);
        expect(regionSummary(p, 'alerts')).toBe('2 條規則、提醒框外觀、語音');
        expect(regionSummary(p, 'dps')).toBe('');
    });
});

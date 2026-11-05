import { describe, it, expect, beforeEach } from 'vitest';
import {
    defaultOverlaySettings, normalizeOverlaySettings, loadOverlaySettings, saveOverlaySettings,
    FONT_PX,
} from './overlaySettings';
import { resetSettingsForTest, saveSetting } from './settingsStorage';

beforeEach(() => { resetSettingsForTest(); });

describe('defaults', () => {
    it('match the plan', () => {
        const d = defaultOverlaySettings();
        expect(d.v).toBe(2);
        expect(d.scale).toBe(100);
        expect(d.dpsLook.columns).toEqual({ dps: true, total: false, share: true });
        expect(d.dpsLook.font).toBe('m');
        expect(d.ccBoss.items.map(i => i.id)).toContain(323);
        expect(d.ccBoss.items.map(i => i.id)).not.toContain(516);
        expect(d.burst.items.map(i => i.id)).toEqual([516, 900206]);
        expect(d.cooldown.items.map(i => i.skillId)).toEqual([59005, 59143, 59123]);
        expect(FONT_PX).toEqual({ s: 12, m: 14, l: 16 });
    });
    it('has no widgets or old dps look', () => {
        const d = defaultOverlaySettings() as unknown as Record<string, unknown>;
        expect(d.widgets).toBeUndefined();
        expect(d.dps).toBeUndefined();
    });
    it('returns independent copies', () => {
        const a = defaultOverlaySettings();
        a.ccSelf.items.pop();
        a.cooldown.items.pop();
        const d = defaultOverlaySettings();
        expect(d.ccSelf.items).toHaveLength(defaultOverlaySettings().ccSelf.items.length);
        expect(d.cooldown.items).toHaveLength(3);
    });
});

describe('normalizeOverlaySettings', () => {
    it('null gives defaults', () => {
        expect(normalizeOverlaySettings(null)).toEqual(defaultOverlaySettings());
    });
    it('clamps opacity and fixes invalid fields', () => {
        const n = normalizeOverlaySettings({ alerts: { opacity: 250, fontSize: 'xl' } });
        expect(n.alerts).toMatchObject({ opacity: 100, fontSize: 'm' });
    });
    it('ignores saved widgets', () => {
        const n = normalizeOverlaySettings({ widgets: [{ id: 'a', kind: 'cc', ccIds: [5] }] }) as unknown as Record<string, unknown>;
        expect(n.widgets).toBeUndefined();
    });
});

describe('load / save', () => {
    it('round trips', () => {
        const s = defaultOverlaySettings();
        s.dpsLook.font = 'l';
        s.ccSelf.items.pop();
        saveOverlaySettings(s);
        expect(loadOverlaySettings()).toEqual(s);
    });
    it('normalises stored data and survives corrupt storage', () => {
        saveSetting('overlay', { v: 2, scale: 999 });
        expect(loadOverlaySettings().scale).toBe(150);
        saveSetting('overlay', 'bad');
        expect(loadOverlaySettings()).toEqual(defaultOverlaySettings());
    });
});

describe('settings version', () => {
    it('a saved v1 object loads as the defaults', () => {
        saveSetting('overlay', { v: 1, scale: 120 });
        expect(loadOverlaySettings()).toEqual(defaultOverlaySettings());
    });
});

describe('new settings', () => {
    it('defaults', () => {
        const d = defaultOverlaySettings();
        expect(d.scale).toBe(100);
        expect(d.alerts).toEqual({ opacity: 60, bg: '#0e1013', fontSize: 'm' });
        expect(d.rules.map(x => x.id)).toEqual(['d-prelude', 'd-lively', 'd-march', 'd-def', 'd-mdef', 'd-dmg']);
        expect(d.voice).toEqual({ voiceName: '', rate: 1.2, volume: 100, muted: false });
    });
    it('ignores a legacy cc.cooldown', () => {
        const n = normalizeOverlaySettings({ cc: { cooldown: false } });
        expect(n).toEqual(defaultOverlaySettings());
    });
    it('clamps scale, rate and volume', () => {
        expect(normalizeOverlaySettings({ scale: 10 }).scale).toBe(80);
        expect(normalizeOverlaySettings({ scale: 999 }).scale).toBe(150);
        expect(normalizeOverlaySettings({ scale: 'x' }).scale).toBe(100);
        const v = normalizeOverlaySettings({ voice: { rate: 5, volume: -3, muted: true, voiceName: 'A' } }).voice;
        expect(v).toEqual({ voiceName: 'A', rate: 1.8, volume: 0, muted: true });
        expect(normalizeOverlaySettings({ voice: { rate: 0.1, volume: 500 } }).voice).toMatchObject({ rate: 0.6, volume: 100 });
    });
    it('normalises alerts appearance and background colour', () => {
        const n = normalizeOverlaySettings({ alerts: { opacity: 20, fontSize: 'z', bg: '#ABCDEF' } });
        expect(n.alerts).toEqual({ opacity: 20, bg: '#abcdef', fontSize: 'm' });
        expect(normalizeOverlaySettings({ alerts: { bg: 'red' } }).alerts.bg).toBe('#0e1013');
    });
    const countdown = {
        id: 'a', enabled: false, kind: 'countdown', target: 'boss', ccId: 803, times: [3, 10, 3, 5.4, -1, 'x'], every: 45,
        conds: [{ mode: 'absent', ccId: 516 }], join: 'or', text: false, textMessage: 'hi', voice: true, voiceMessage: 'yo',
        textKeep: 9, loud: false, dismiss: { condFails: true, ccEnds: true, replaced: false },
    };
    const rulesOf = (...rs: unknown[]) => normalizeOverlaySettings({ rules: rs }).rules;
    it('drops invalid rules, keeps valid ones', () => {
        const n = rulesOf(
            countdown,
            { ...countdown, id: 'b', ccId: undefined },
            { ...countdown, id: 'c', target: 'x' },
            { ...countdown, id: 'd', times: [] },
            { ...countdown, id: '' },
            { ...countdown, id: 'f', kind: 'other' },
            { ...countdown, id: 'e', conds: [{ mode: 'bad', ccId: 1 }], textMessage: 5 },
            null,
        );
        expect(n.map(r => r.id)).toEqual(['a', 'e']);
        expect(n[0]).toEqual({ ...countdown, times: [10, 5, 3] });
        expect(n[1].conds).toEqual([]);
        expect(n[1].textMessage).toBe('');
    });
    it('rules default to enabled with text and voice on', () => {
        const r = rulesOf({ id: 'a', kind: 'countdown', target: 'self', ccId: 1, times: [3] })[0];
        expect(r).toEqual({
            id: 'a', enabled: true, kind: 'countdown', target: 'self', ccId: 1, times: [3], every: 30,
            conds: [], join: 'and', text: true, textMessage: '', voice: true, voiceMessage: '', textKeep: 5,
            loud: false, dismiss: { condFails: false, ccEnds: false, replaced: false },
        });
    });
    it('an appear rule keeps its cc and drops the times', () => {
        const r = rulesOf({ id: 'p', kind: 'appear', target: 'self', ccId: 516, times: [3], loud: true })[0];
        expect(r).toMatchObject({ kind: 'appear', ccId: 516, times: [], loud: true });
        expect(rulesOf({ id: 'p', kind: 'appear', target: 'self' })).toEqual([]);
    });
    it('default rules: music buffs at 30 s without 圖安之魂, boss debuffs', () => {
        const d = defaultOverlaySettings().rules;
        const by = (id: string) => d.find(x => x.id === id)!;
        for (const id of ['d-prelude', 'd-lively', 'd-march']) {
            expect(by(id)).toMatchObject({ kind: 'countdown', target: 'self', times: [30], conds: [{ mode: 'absent', ccId: 1124 }] });
        }
        expect(d.map(x => x.ccId)).toEqual([680, 192, 193, 1164, 1165, 1166]);
        expect(['d-def', 'd-mdef', 'd-dmg'].map(id => [by(id).target, by(id).times])).toEqual(Array(3).fill(['boss', [30]]));
    });
    it('a first run and an empty list saved before sections get the default rules; a later empty list stays empty', () => {
        const ids = (v: unknown) => normalizeOverlaySettings(v).rules.length;
        expect(ids({})).toBe(6);
        expect(ids({ rules: [] })).toBe(6);
        expect(ids({ rules: [], widgets: [] })).toBe(0);
        expect(ids({ rules: [], general: {} })).toBe(0);
    });
    it('keeps the whole-party target', () => {
        expect(rulesOf({ id: 'a', kind: 'countdown', target: 'all', ccId: 1, times: [3] })[0].target).toBe('all');
    });
    it('a periodic rule needs no cc or times and zeroes them', () => {
        const r = rulesOf({ id: 'p', kind: 'periodic', target: 'self', ccId: 7, times: [3], every: 12 })[0];
        expect(r).toMatchObject({ kind: 'periodic', ccId: 0, times: [], every: 12 });
    });
    it('every is rounded and clamped to 1..3600, defaulting to 30', () => {
        const every = (v: unknown) => rulesOf({ id: 'p', kind: 'periodic', target: 'self', every: v })[0].every;
        expect([every(0), every(0.4), every(2.6), every(99999), every('x'), every(undefined), every(NaN)])
            .toEqual([1, 1, 3, 3600, 30, 30, 30]);
    });
    it('textKeep is rounded and clamped to 1..600, defaulting to 5', () => {
        const keep = (v: unknown) => rulesOf({ ...countdown, textKeep: v })[0].textKeep;
        expect([keep(0), keep(7.4), keep(1000), keep('x'), keep(undefined)]).toEqual([1, 7, 600, 5, 5]);
    });
    it('join defaults to and; dismiss flags default false', () => {
        const r = rulesOf({ ...countdown, join: 'xor', dismiss: { condFails: 'yes', replaced: true } })[0];
        expect(r.join).toBe('and');
        expect(r.dismiss).toEqual({ condFails: false, ccEnds: false, replaced: true });
    });
    it('conds drop invalid entries and keep order', () => {
        const r = rulesOf({ ...countdown, conds: [
            { mode: 'present', ccId: 2 }, { mode: 'absent', ccId: 0 }, null, { mode: 'x', ccId: 3 }, { mode: 'absent', ccId: 4 },
        ] })[0];
        expect(r.conds).toEqual([{ mode: 'present', ccId: 2 }, { mode: 'absent', ccId: 4 }]);
        expect(rulesOf({ ...countdown, conds: 'no' })[0].conds).toEqual([]);
    });
    it('rules round trip through load/save', () => {
        const s = defaultOverlaySettings();
        s.rules = [{
            id: 'a', enabled: true, kind: 'countdown', target: 'party', ccId: 2, times: [9, 1], every: 30,
            conds: [{ mode: 'present', ccId: 5 }], join: 'or', text: true, textMessage: '', voice: false, voiceMessage: '',
            textKeep: 5, loud: true, dismiss: { condFails: false, ccEnds: false, replaced: false },
        }];
        saveOverlaySettings(s);
        expect(loadOverlaySettings()).toEqual(s);
    });
});

describe('v1 migration to sections', () => {
    const rule = { id: 'r1', kind: 'countdown', target: 'boss', ccId: 1164, times: [30] };
    it('keeps scale, rules, voice and the DPS look; sizes the CC sections', () => {
        const n = normalizeOverlaySettings({
            v: 1, scale: 120,
            dps: { opacity: 80, bg: '#112233', fontSize: 'l', columns: { dps: true, total: true, share: false }, top: { boss: false, time: true, partyDps: true } },
            cc: { opacity: 0, iconSize: 's', sections: { boss: [803] } },
            rules: [rule], voice: { rate: 1.5 },
        });
        expect(n.scale).toBe(120);
        expect(n.rules).toHaveLength(1);
        expect(n.voice.rate).toBe(1.5);
        expect(n.dpsLook.font).toBe('l');
        expect(n.dpsLook.columns).toEqual({ dps: true, total: true, share: false });
        expect(n.dpsLook.top).toMatchObject({ boss: false, partyDps: true, hpPct: true });
        expect(n.dpsLook.bg).toEqual({ color: '#112233', alpha: 80 });
        for (const id of ['ccBoss', 'ccSelf', 'ccParty'] as const) expect(n[id].look.size).toBe('s');
        expect(n.burst.look.size).toBe('c');
        expect(n.ccBoss.items).toEqual(defaultOverlaySettings().ccBoss.items);
    });
    it('garbage gives the defaults for the new fields', () => {
        const d = defaultOverlaySettings();
        for (const g of [{}, null, 'x', { ccBoss: 3, dpsLook: [], general: 1, cooldown: 'x' }]) {
            const n = normalizeOverlaySettings(g);
            expect(n.general).toEqual(d.general);
            expect(n.ccBoss).toEqual(d.ccBoss);
            expect(n.ccSelf).toEqual(d.ccSelf);
            expect(n.ccParty).toEqual(d.ccParty);
            expect(n.burst).toEqual(d.burst);
            expect(n.cooldown).toEqual(d.cooldown);
            expect(n.dpsLook).toEqual(d.dpsLook);
        }
    });
    it('saved new fields round-trip', () => {
        const d = defaultOverlaySettings();
        d.ccSelf.items.pop();
        d.general.warn = '#010203';
        const n = normalizeOverlaySettings(JSON.parse(JSON.stringify(d)));
        expect(n.ccSelf.items).toHaveLength(d.ccSelf.items.length);
        expect(n.general.warn).toBe('#010203');
    });
});

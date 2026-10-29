import { describe, it, expect, beforeEach } from 'vitest';
import {
    defaultOverlaySettings, normalizeOverlaySettings, loadOverlaySettings, saveOverlaySettings,
    DEFAULT_SELF_CC, DEFAULT_BOSS_CC, FONT_PX, ICON_PX,
} from './overlaySettings';
import { resetSettingsForTest, saveSetting } from './settingsStorage';

beforeEach(() => { resetSettingsForTest(); });

describe('defaults', () => {
    it('match the plan', () => {
        const d = defaultOverlaySettings();
        expect(d.v).toBe(1);
        expect(d.dps.columns).toEqual({ dps: true, total: false, share: true });
        expect(d.dps.top).toEqual({ boss: true, time: true, partyDps: false });
        expect(d.dps.opacity).toBe(60);
        expect(d.cc.opacity).toBe(0);
        expect(d.dps.fontSize).toBe('m');
        expect(d.cc.iconSize).toBe('m');
        expect(d.cc.sections.self).toEqual([516, 680, 192]);
        expect(d.cc.sections.party).toEqual([516, 680, 192]);
        expect(DEFAULT_SELF_CC).toEqual([516, 680, 192]);
        expect(d.cc.sections.boss).not.toContain(494);
        expect(d.cc.sections.boss).not.toContain(516);
        expect(DEFAULT_BOSS_CC).toEqual(d.cc.sections.boss);
        expect(FONT_PX).toEqual({ s: 12, m: 14, l: 16 });
        expect(ICON_PX).toEqual({ s: 24, m: 32, l: 40 });
    });
    it('returns independent copies', () => {
        const a = defaultOverlaySettings();
        a.cc.sections.self.push(1);
        expect(defaultOverlaySettings().cc.sections.self).toEqual([516, 680, 192]);
    });
});

describe('normalizeOverlaySettings', () => {
    it('null gives defaults', () => {
        expect(normalizeOverlaySettings(null)).toEqual(defaultOverlaySettings());
    });
    it('clamps opacity and fixes invalid fields', () => {
        const n = normalizeOverlaySettings({ dps: { opacity: 250, fontSize: 'xl' }, cc: { opacity: -5 } });
        expect(n.dps.opacity).toBe(100);
        expect(n.dps.fontSize).toBe('m');
        expect(n.cc.opacity).toBe(0);
    });
    it('drops garbage list entries and duplicates', () => {
        const n = normalizeOverlaySettings({ cc: { sections: { self: [5, 'x', 5, null, 7.5, -1, 6], party: 'bad' } } });
        expect(n.cc.sections.self).toEqual([5, 6]);
        expect(n.cc.sections.party).toEqual([516, 680, 192]);
    });
    it('keeps valid booleans', () => {
        const n = normalizeOverlaySettings({ dps: { columns: { total: true, dps: false } } });
        expect(n.dps.columns).toEqual({ dps: false, total: true, share: true });
    });
});

describe('load / save', () => {
    it('round trips', () => {
        const s = defaultOverlaySettings();
        s.dps.opacity = 33;
        s.cc.sections.boss = [7, 1];
        saveOverlaySettings(s);
        expect(loadOverlaySettings()).toEqual(s);
    });
    it('normalises stored data and survives corrupt storage', () => {
        saveSetting('overlay', { dps: { opacity: 999 } });
        expect(loadOverlaySettings().dps.opacity).toBe(100);
        saveSetting('overlay', 'bad');
        expect(loadOverlaySettings()).toEqual(defaultOverlaySettings());
    });
});

describe('new settings', () => {
    it('defaults', () => {
        const d = defaultOverlaySettings();
        expect(d.scale).toBe(100);
        expect(d.cooldown).toEqual({ opacity: 60, iconSize: 'm' });
        expect(d.alerts).toEqual({ opacity: 60, fontSize: 'm' });
        expect(d.rules).toEqual([]);
        expect(d.voice).toEqual({ voiceName: '', rate: 1.2, volume: 100, muted: false });
    });
    it('ignores a legacy cc.cooldown', () => {
        const n = normalizeOverlaySettings({ cc: { cooldown: false } });
        expect('cooldown' in n.cc).toBe(false);
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
    it('normalises cooldown and alerts appearance', () => {
        const n = normalizeOverlaySettings({ cooldown: { opacity: 500, iconSize: 'l' }, alerts: { opacity: 20, fontSize: 'z' } });
        expect(n.cooldown).toEqual({ opacity: 100, iconSize: 'l' });
        expect(n.alerts).toEqual({ opacity: 20, fontSize: 'm' });
    });
    const countdown = {
        id: 'a', enabled: false, kind: 'countdown', target: 'boss', ccId: 803, times: [3, 10, 3, 5.4, -1, 'x'], every: 45,
        conds: [{ mode: 'absent', ccId: 516 }], join: 'or', text: false, textMessage: 'hi', voice: true, voiceMessage: 'yo',
        textKeep: 9, dismiss: { condFails: true, ccEnds: true, replaced: false },
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
            dismiss: { condFails: false, ccEnds: false, replaced: false },
        });
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
            textKeep: 5, dismiss: { condFails: false, ccEnds: false, replaced: false },
        }];
        saveOverlaySettings(s);
        expect(loadOverlaySettings()).toEqual(s);
    });
});

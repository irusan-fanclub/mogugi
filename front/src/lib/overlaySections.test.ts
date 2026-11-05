import { describe, it, expect } from 'vitest';
import {
    defaultCcSection, defaultCooldownSection, defaultDpsLook, defaultGeneral, defaultCcItem, defaultCooldownItem,
    iconPx, dpsFontPx, orderedKeys, normalizeCcSection, normalizeCooldownSection, normalizeGeneral, normalizeDpsLook,
    itemKey, unitId,
} from './overlaySections';

describe('defaults', () => {
    it('ccBoss items', () => {
        const s = defaultCcSection('ccBoss');
        expect(s.items.map(i => [i.id, i.label])).toEqual([[1164, '減物保'], [1165, '減魔保'], [1166, '增傷'], [323, '憤衝']]);
        expect(s.items[3].icon).toEqual({ kind: 'skill', id: 20018 });
        expect(s.look).toEqual({ size: 'm', px: 36, names: 'label', dim: 40, bg: null, title: false });
    });
    it('ccSelf and ccParty', () => {
        const s = defaultCcSection('ccSelf');
        expect(s.items.map(i => i.id)).toEqual([680, 192, 193, 476, 63, 1121, 1150, 1225]);
        expect(s.look.title).toBe(true);
        const g = s.items[3];
        expect(g.ids).toEqual([476, 511]);
        expect(g.warnSec).toBe(15);
        expect(s.items[0].renew).toBe(1124);
        expect(defaultCcSection('ccParty').look.names).toBe('member');
        expect(defaultCcSection('ccParty').items.map(i => i.id)).toEqual([680, 192, 193, 63, 1121, 1150, 476, 1120, 1122, 1225]);
    });
    it('burst', () => {
        const s = defaultCcSection('burst');
        expect(s.look).toEqual({ size: 'c', px: 52, names: 'label', dim: 100, bg: null, title: false });
        expect(s.items.map(i => [i.id, i.label, i.warnHl, i.goneHl])).toEqual([[516, '覺醒', false, false], [900206, '戰吼', false, false]]);
    });
    it('cooldown, dps, general', () => {
        const c = defaultCooldownSection();
        expect(c.items.map(i => [i.skillId, i.cooldownSec, i.ccId, i.who])).toEqual([
            [59005, 180, 803, 'party'], [59143, 60, 0, 'party'], [59123, 30, 0, 'party']]);
        expect(c.look).toEqual({ size: 'm', px: 36, names: true, bg: null, title: false });
        expect(defaultDpsLook().top).toEqual({ boss: true, hpPct: true, hpLeft: false, time: true, partyDps: true });
        expect(defaultDpsLook().bg).toEqual({ color: '#0e1013', alpha: 25 });
        expect(defaultGeneral()).toEqual({ bg: { color: '#0e1013', alpha: 0 }, warn: '#e8a33d', gone: '#e5534b', ok: '#5cc26a' });
    });
    it('generic items', () => {
        expect(defaultCcItem('ccBoss', 999, 'x')).toMatchObject({ id: 999, ids: [999], label: 'x', warnSec: 30, warnHl: true, renew: 0, icon: { kind: 'cc', id: 999 } });
        expect(defaultCcItem('ccBoss', 1164, 'x').label).toBe('減物保');
        expect(defaultCooldownItem(5)).toMatchObject({ skillId: 5, cooldownSec: 60, ccId: 0, who: 'party' });
    });
});

describe('helpers', () => {
    it('sizes', () => {
        expect(iconPx({ size: 'c', px: 60 })).toBe(60);
        expect(iconPx({ size: 'l', px: 60 })).toBe(44);
        expect(dpsFontPx({ ...defaultDpsLook(), font: 's' })).toBe(12);
        expect(dpsFontPx({ ...defaultDpsLook(), font: 'c', fpx: 20 })).toBe(20);
    });
    it('orderedKeys', () => {
        expect(orderedKeys(['1', '2', '3'], ['3', 'x', '1', '3'])).toEqual(['3', '1', '2']);
        expect(orderedKeys(['1', '2'], undefined)).toEqual(['1', '2']);
    });
    it('keys', () => {
        expect(itemKey(defaultCcItem('ccBoss', 7, 'a'))).toBe('7');
        expect(itemKey(defaultCooldownItem(9))).toBe('9');
        expect(unitId('ccBoss', '7')).toBe('ccBoss-7');
    });
});

describe('normalize', () => {
    it('drops bad and duplicate items, clamps', () => {
        const s = normalizeCcSection({
            look: { size: 'c', px: 500, names: 'bogus', dim: 1, bg: { color: 'nope', alpha: 300 } },
            items: [
                { id: 0 }, { id: -3 }, { id: 5, warnSec: 9999, label: '一二三四五六七八', arcana: [3, 3, 0, 11, 10], mateArcana: [4, 'x', 4, 12] },
                { id: 5 }, { id: 6, ids: [9, 6, 9], warnSec: -1 },
            ],
        }, 'ccParty');
        expect(s.items.map(i => i.id)).toEqual([5, 6]);
        expect(s.items[0].warnSec).toBe(600);
        expect(s.items[0].label).toBe('一二三四五六');
        expect(s.items[0].arcana).toEqual([3, 10]);
        expect(s.items[0].mateArcana).toEqual([4]);
        expect(s.items[1].mateArcana).toEqual([]);
        expect(s.items[1].warnSec).toBe(1);
        expect(s.items[1].ids).toEqual([6, 9]);
        expect(s.look.px).toBe(96);
        expect(s.look.dim).toBe(10);
        expect(s.look.names).toBe('member');
        expect(s.look.bg).toEqual({ color: '#0e1013', alpha: 100 });
    });
    it('cuts labels by code point', () => {
        const s = normalizeCcSection({ items: [{ id: 1, label: '😀😀😀😀😀😀😀' }] }, 'ccBoss');
        expect(Array.from(s.items[0].label)).toHaveLength(6);
    });
    it('missing items give defaults, empty list stays empty', () => {
        expect(normalizeCcSection({}, 'burst')).toEqual(defaultCcSection('burst'));
        expect(normalizeCcSection(null, 'ccSelf')).toEqual(defaultCcSection('ccSelf'));
        expect(normalizeCcSection({ items: [] }, 'ccSelf').items).toEqual([]);
    });
    it('round-trips defaults', () => {
        for (const id of ['ccBoss', 'ccSelf', 'ccParty', 'burst'] as const) {
            expect(normalizeCcSection(JSON.parse(JSON.stringify(defaultCcSection(id))), id)).toEqual(defaultCcSection(id));
        }
        expect(normalizeCooldownSection(JSON.parse(JSON.stringify(defaultCooldownSection())))).toEqual(defaultCooldownSection());
    });
    it('cooldown', () => {
        const s = normalizeCooldownSection({ look: { px: 2, names: 'x' }, items: [{ skillId: 1, who: 'zz', cooldownSec: 0 }, { skillId: 1 }, { skillId: 0 }] });
        expect(s.items).toHaveLength(1);
        expect(s.items[0]).toMatchObject({ who: 'party', cooldownSec: 1, enabled: true });
        expect(s.look.px).toBe(16);
        expect(s.look.names).toBe(true);
    });
    it('general', () => {
        expect(normalizeGeneral({ warn: 'red', ok: '#ABCDEF', bg: { alpha: 5 } })).toEqual({
            bg: { color: '#0e1013', alpha: 5 }, warn: '#e8a33d', gone: '#e5534b', ok: '#abcdef' });
    });
    it('dps look', () => {
        expect(normalizeDpsLook(undefined)).toEqual(defaultDpsLook());
        const l = normalizeDpsLook({ font: 'c', fpx: 99, bg: { color: '#112233', alpha: 80 } });
        expect(l.fpx).toBe(40);
        expect(l.bg).toEqual({ color: '#112233', alpha: 80 });
        const m = normalizeDpsLook(undefined, { fontSize: 'l', opacity: 50, columns: { total: true }, top: { boss: false } });
        expect(m.font).toBe('l');
        expect(m.bg).toEqual({ color: '#0e1013', alpha: 50 });
        expect(m.columns.total).toBe(true);
        expect(m.top.boss).toBe(false);
        expect(normalizeDpsLook(undefined, { fontSize: 'l' }).bg).toEqual(defaultDpsLook().bg);
        expect(normalizeDpsLook({ bg: null }).bg).toBeNull();
    });
});

import { describe, expect, it } from 'vitest';
import {
    defaultFrameRec, frameField, memberClassOf, missingFrameRecords, parseFrame, resetFrameRec, sectionTitle,
} from './overlayFrames';
import type { OverlayLayout } from './overlayProtocol';
import { defaultOverlaySettings } from './overlaySettings';

const L = (o: Partial<OverlayLayout> = {}): OverlayLayout => ({ enabled: true, anchor: 'tl', x: 1, y: 2, width: 120, maxRows: 1, ...o });

describe('parseFrame', () => {
    it('round-trips a default group record', () => {
        expect(parseFrame('ccParty', frameField(defaultFrameRec('ccParty', 'group', 2))))
            .toEqual({ n: 2, name: '隊伍 CC 2', titleOn: null, look: null });
    });
    it('rejects garbage', () => {
        expect(parseFrame('ccParty', 'not json')).toBeNull();
        expect(parseFrame('ccParty', '{"n":0}')).toBeNull();
        expect(parseFrame('ccParty', undefined)).toBeNull();
    });
    it('normalizes a custom look and the name', () => {
        const r = parseFrame('ccParty', JSON.stringify({ n: 1, name: `a\u0007${'b'.repeat(30)}`, titleOn: 'x', look: { size: 'x' } }));
        expect(r?.look && 'size' in r.look && r.look.size).toBe('m');
        expect(r?.titleOn).toBeNull();
        expect(Array.from(r?.name ?? '').length).toBe(16);
        expect(r?.name).not.toContain('\u0007');
        expect(parseFrame('cooldown', '{"n":3,"name":"","look":{"names":false}}')?.name).toBe('技能冷卻 3');
    });
});

describe('defaults', () => {
    it('unit vs group and reset', () => {
        expect(defaultFrameRec('ccSelf', 'unit', 1).titleOn).toBe(false);
        const r = { ...defaultFrameRec('ccSelf', 'group', 4), name: 'zz', titleOn: true };
        expect(resetFrameRec('ccSelf', 'group', r)).toEqual(defaultFrameRec('ccSelf', 'group', 4));
    });
    it('sectionTitle', () => {
        const s = defaultOverlaySettings();
        expect(sectionTitle(s, 'ccParty')).toBe('隊伍 CC');
        s.ccParty.look.titleText = '我的';
        expect(sectionTitle(s, 'ccParty')).toBe('我的');
    });
    it('memberClassOf', () => {
        expect(memberClassOf('ccParty', '1150')).toBe('63');
        expect(memberClassOf('ccParty', '1121')).toBe('63');
        expect(memberClassOf('ccParty', '192')).toBe('680');
        expect(memberClassOf('cooldown', '63')).toBe('63');
        expect(memberClassOf('cooldown', '192')).toBe('192');
        expect(memberClassOf('ccParty', '476')).toBe('476');
    });
});

describe('missingFrameRecords', () => {
    const s = defaultOverlaySettings();
    it('numbers groups by g-number then units by item order', () => {
        const out = missingFrameRecords(s, {
            'ccParty-g3': L(), 'ccParty-g1': L(), 'ccParty-476': L(), 'ccSelf-63': L(),
        });
        const n = (id: string) => parseFrame(id.startsWith('ccParty') ? 'ccParty' : 'ccSelf', out[id].frame);
        expect(n('ccParty-g1')?.n).toBe(1);
        expect(n('ccParty-g3')?.n).toBe(2);
        expect(n('ccParty-476')?.n).toBe(3);
        expect(n('ccParty-476')?.titleOn).toBe(false);
        expect(n('ccSelf-63')?.n).toBe(1);
        expect(out['ccParty-g1']).toMatchObject({ x: 1, width: 120 });
    });
    it('skips recorded layouts and avoids their n', () => {
        const rec = frameField(defaultFrameRec('ccParty', 'group', 1));
        const out = missingFrameRecords(s, { 'ccParty-g1': L({ frame: rec }), 'ccParty-g2': L() });
        expect(Object.keys(out)).toEqual(['ccParty-g2']);
        expect(parseFrame('ccParty', out['ccParty-g2'].frame)?.n).toBe(2);
    });
    it('ignores ids that are not a unit or group of the section', () => {
        const out = missingFrameRecords(s, { ccParty: L(), 'ccParty-999999': L(), dps: L(), 'ccSelf-g1': L() });
        expect(Object.keys(out)).toEqual(['ccSelf-g1']);
    });
});

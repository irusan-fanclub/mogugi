import { describe, it, expect } from 'vitest';
import { defaultOverlaySettings } from '@/lib/overlaySettings';
import type { ComponentDef } from '@/lib/overlayComponents';
import { frameField, type FrameRec } from '@/lib/overlayFrames';
import type { TileVM } from '@/lib/overlayTiles';
import { bgOf, frameLook, frameTitle, labelOf, tileLook } from './sectionView';

const lay = { enabled: true, anchor: 'tl', x: 0, y: 0, width: 100, maxRows: 1 } as const;
const withRec = (id: string, r: Partial<FrameRec>) => ({
    [id]: { ...lay, frame: frameField({ n: 1, name: '隊伍 CC 1', titleOn: null, look: null, ...r }) },
});
const sec = (): ComponentDef => ({ id: 'ccParty', name: '隊伍 CC', kind: 'section', section: 'ccParty' } as ComponentDef);
const grp = (): ComponentDef => ({ id: 'ccParty-g1', name: 'g', kind: 'group', section: 'ccParty', keys: ['680'] } as ComponentDef);
const unit = (): ComponentDef => ({ id: 'ccParty-680', name: 'u', kind: 'unit', section: 'ccParty', key: '680' } as ComponentDef);

describe('frameLook', () => {
    it('uses the record look, else the section look', () => {
        const s = defaultOverlaySettings();
        const own = { ...s.ccParty.look, size: 'l' as const };
        expect(frameLook(s, grp(), withRec('ccParty-g1', { look: own })).size).toBe('l');
        expect(frameLook(s, grp(), withRec('ccParty-g1', { look: null }))).toBe(s.ccParty.look);
    });

    it('follows a section size change', () => {
        const s = defaultOverlaySettings();
        const l = withRec('ccParty-g1', { look: null });
        const before = tileLook(s, grp(), l).px;
        s.ccParty.look = { ...s.ccParty.look, size: 'l' };
        expect(tileLook(s, grp(), l).px).not.toBe(before);
    });
});

describe('bgOf', () => {
    it('a frame look with its own bg wins over the section bg', () => {
        const s = defaultOverlaySettings();
        s.ccParty.look = { ...s.ccParty.look, bg: { color: '#112233', alpha: 50 } };
        const own = { ...s.ccParty.look, bg: { color: '#445566', alpha: 80 } };
        expect(bgOf(s, grp(), withRec('ccParty-g1', { look: own }))).toBe('rgba(68,85,102,0.8)');
        expect(bgOf(s, grp(), withRec('ccParty-g1', { look: null }))).toBe('rgba(17,34,51,0.5)');
    });
});

describe('frameTitle', () => {
    it('a unit without a record shows none', () => {
        const s = defaultOverlaySettings();
        s.ccParty.look = { ...s.ccParty.look, title: true };
        expect(frameTitle(s, unit(), undefined)).toBe('');
    });

    it('a group without a record follows the section rule', () => {
        const s = defaultOverlaySettings();
        s.ccParty.look = { ...s.ccParty.look, title: true };
        expect(frameTitle(s, grp(), undefined)).toBe('隊伍 CC');
    });

    it('record name follows section title; titleOn overrides', () => {
        const s = defaultOverlaySettings();
        const l = withRec('ccParty-g1', {});
        s.ccParty.look = { ...s.ccParty.look, title: false };
        expect(frameTitle(s, grp(), l)).toBe('');
        s.ccParty.look = { ...s.ccParty.look, title: true };
        expect(frameTitle(s, grp(), l)).toBe('隊伍 CC 1');
        expect(frameTitle(s, grp(), withRec('ccParty-g1', { titleOn: false }))).toBe('');
        s.ccParty.look = { ...s.ccParty.look, title: false };
        expect(frameTitle(s, grp(), withRec('ccParty-g1', { titleOn: true }))).toBe('隊伍 CC 1');
    });

    it('the section frame uses titleText', () => {
        const s = defaultOverlaySettings();
        s.ccParty.look = { ...s.ccParty.look, title: true, titleText: 'BUFF' };
        expect(frameTitle(s, sec(), undefined)).toBe('BUFF');
    });
});

describe('labelOf', () => {
    const tile = (o: Partial<TileVM> = {}): TileVM => ({
        key: '680', holderId: 'h', label: 'x', icon: { kind: 'cc', id: 1 }, sec: '', state: 'ok', hl: false,
        faint: false, mask: 0, isSelf: false, itemLabel: 'Item', holderName: 'Bob', fixedLabel: false, ...o,
    });
    const look = (names: unknown) => ({ ...defaultOverlaySettings().ccParty.look, names }) as never;

    it('picks the part the look names', () => {
        expect(labelOf(tile(), look('label'), false)).toBe('Item');
        expect(labelOf(tile(), look('member'), false)).toBe('Bob');
        expect(labelOf(tile(), look('none'), false)).toBe('');
    });

    it('by-member rows drop the member name', () => {
        expect(labelOf(tile(), look('member'), true)).toBe('');
        expect(labelOf(tile(), look(true), true)).toBe('');
        expect(labelOf(tile(), look('label'), true)).toBe('Item');
    });

    it('a fixed label always stays', () => {
        expect(labelOf(tile({ fixedLabel: true, label: '1:30' }), look('none'), true)).toBe('1:30');
    });
});

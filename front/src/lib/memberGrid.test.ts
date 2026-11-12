import { describe, it, expect } from 'vitest';
import { buildMemberGrid } from './memberGrid';
import { memberClassOf } from './overlayFrames';
import type { TileVM } from './overlayTiles';

const t = (holderId: string, key: string): TileVM => ({
    key, holderId, label: '', icon: { kind: 'cc', id: 1 }, sec: '', state: 'ok', hl: false, faint: false, mask: 0,
    isSelf: false, itemLabel: key, holderName: holderId, fixedLabel: false,
});
const KEYS = ['680', '192', '193', '63', '1121', '476'];
const cls = (k: string) => memberClassOf('ccParty', k);
const keysOf = (r: { cells: (TileVM | null)[] }) => r.cells.map(c => c?.key ?? null);
const tiles = [t('A', '680'), t('A', '193'), t('A', '63'), t('A', '476'), t('B', '192'), t('B', '1121')];

describe('buildMemberGrid', () => {
    it('merges same-class keys into one column and leaves gaps', () => {
        const rows = buildMemberGrid(tiles, KEYS, cls, 'keep');
        expect(rows.map(r => r.holderId)).toEqual(['A', 'B']);
        expect(keysOf(rows[0])).toEqual(['680', '193', '63', '476']);
        expect(keysOf(rows[1])).toEqual(['192', null, '1121', null]);
    });

    it('pack moves the gaps to the end of each row', () => {
        const rows = buildMemberGrid(tiles, KEYS, cls, 'pack');
        expect(keysOf(rows[1])).toEqual(['192', '1121', null, null]);
    });

    it('drops a column nobody has', () => {
        const rows = buildMemberGrid([t('A', '680')], KEYS, cls, 'keep');
        expect(keysOf(rows[0])).toEqual(['680']);
    });

    it('the earliest key of a class wins', () => {
        const rows = buildMemberGrid([t('A', '1150'), t('A', '63')], ['63', '1150'], cls, 'keep');
        expect(keysOf(rows[0])).toEqual(['63']);
    });
});

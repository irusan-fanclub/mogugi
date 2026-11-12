import { describe, it, expect } from 'vitest';
import { defaultCcSection } from '@/lib/overlaySections';
import { sampleMemberTiles } from './sampleData';

describe('sampleMemberTiles', () => {
    it('gives every enabled key a tile for each of three sample teammates, key-major', () => {
        const sec = defaultCcSection('ccParty');
        sec.items = sec.items.slice(0, 2).map(i => ({ ...i, enabled: true }));
        const keys = sec.items.map(i => String(i.id));
        const tiles = sampleMemberTiles(sec, keys);
        expect(tiles.map(t => t.key)).toEqual([keys[0], keys[0], keys[0], keys[1], keys[1], keys[1]]);
        expect(tiles.slice(0, 3).map(t => [t.holderId, t.holderName])).toEqual([['s1', '範例1'], ['s2', '範例2'], ['s3', '範例3']]);
    });

    it('skips disabled items and keys that are not listed', () => {
        const sec = defaultCcSection('ccParty');
        sec.items = sec.items.slice(0, 2).map((i, n) => ({ ...i, enabled: n === 0 }));
        const keys = sec.items.map(i => String(i.id));
        expect(sampleMemberTiles(sec, keys).map(t => t.key)).toEqual([keys[0], keys[0], keys[0]]);
        expect(sampleMemberTiles(sec, ['nope'])).toEqual([]);
    });
});

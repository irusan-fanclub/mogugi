import { describe, it, expect } from 'vitest';
import { defaultCcSection } from '@/lib/overlaySections';
import { FUNNY_NAMES } from '@/lib/entityAlias';
import { SAMPLE_NAMES, sampleMemberTiles } from './sampleData';

describe('SAMPLE_NAMES', () => {
    it('all come from the 隨機名稱 word bank', () => {
        expect(SAMPLE_NAMES.filter(n => !FUNNY_NAMES.includes(n))).toEqual([]);
    });
});

describe('sampleMemberTiles', () => {
    it('gives every enabled key a tile for each of three sample teammates, key-major', () => {
        const sec = defaultCcSection('ccParty');
        sec.items = sec.items.slice(0, 2).map(i => ({ ...i, enabled: true }));
        const keys = sec.items.map(i => String(i.id));
        const tiles = sampleMemberTiles(sec, keys);
        expect(tiles.map(t => t.key)).toEqual([keys[0], keys[0], keys[0], keys[1], keys[1], keys[1]]);
        expect(tiles.slice(0, 3).map(t => [t.holderId, t.holderName])).toEqual([['s1', '蘑菇雞'], ['s2', '珍珠奶茶'], ['s3', '喵喵拳']]);
    });

    it('skips disabled items and keys that are not listed', () => {
        const sec = defaultCcSection('ccParty');
        sec.items = sec.items.slice(0, 2).map((i, n) => ({ ...i, enabled: n === 0 }));
        const keys = sec.items.map(i => String(i.id));
        expect(sampleMemberTiles(sec, keys).map(t => t.key)).toEqual([keys[0], keys[0], keys[0]]);
        expect(sampleMemberTiles(sec, ['nope'])).toEqual([]);
    });
});

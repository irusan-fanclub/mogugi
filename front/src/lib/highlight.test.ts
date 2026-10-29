import { describe, it, expect } from 'vitest';
import { highlightParts } from './highlight';

describe('highlightParts', () => {
    it('splits around a match', () => {
        expect(highlightParts('雷楠的米勒', '米')).toEqual([
            { text: '雷楠的', hit: false }, { text: '米', hit: true }, { text: '勒', hit: false },
        ]);
    });
    it('returns the whole text for an empty query or no match', () => {
        expect(highlightParts('abc', '')).toEqual([{ text: 'abc', hit: false }]);
        expect(highlightParts('abc', 'x')).toEqual([{ text: 'abc', hit: false }]);
    });
    it('is case-insensitive and finds repeats', () => {
        expect(highlightParts('AbaB', 'ab').map(p => p.hit)).toEqual([true, true]);
    });
});

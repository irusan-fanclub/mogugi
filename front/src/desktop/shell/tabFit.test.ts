import { describe, it, expect } from 'vitest';
import { fitTabs } from './tabFit';

describe('fitTabs', () => {
    const w = [60, 60, 60, 60, 60];
    it('keeps everything when it fits', () => {
        expect(fitTabs(w, 400, 40, 40, 0)).toEqual([0, 1, 2, 3, 4]);
    });
    it('collapses the overflow behind more', () => {
        expect(fitTabs(w, 200, 40, 40, 0)).toEqual([0, 1]);
    });
    it('swaps a collapsed selection with the last visible tab', () => {
        expect(fitTabs(w, 200, 40, 40, 3)).toEqual([0, 3]);
    });
    it('shows only the selection when nothing fits', () => {
        expect(fitTabs(w, 80, 40, 40, 2)).toEqual([2]);
    });
});

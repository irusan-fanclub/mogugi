import { describe, expect, it } from 'vitest';
import { clockText, gaugeNow, gaugePct, secondsToFull, TUAIRIM_RATE } from './tuairim';

describe('gaugeNow', () => {
    const r = { value: 50, max: 100, at: 1000 };
    it('adds the gain since the reading while gaining', () => {
        expect(gaugeNow(r, 1006, true).value).toBeCloseTo(50 + 6 * TUAIRIM_RATE);
    });
    it('holds still when not gaining', () => {
        expect(gaugeNow(r, 1006, false).value).toBe(50);
    });
    it('stops extrapolating after a long silence and never passes max', () => {
        expect(gaugeNow(r, 5000, true).value).toBeCloseTo(50 + 10 * TUAIRIM_RATE);
        expect(gaugeNow({ ...r, value: 99.9 }, 1009, true).value).toBe(100);
    });
    it('treats an unseen cap as 100', () => {
        expect(gaugeNow({ ...r, max: 0 }, 1000, false).max).toBe(100);
    });
});

describe('gauge text helpers', () => {
    it('600 combat seconds from empty, percent floors', () => {
        expect(secondsToFull({ value: 0, max: 100 })).toBeCloseTo(599.9, 0);
        expect(gaugePct({ value: 73.9, max: 100 })).toBe(73);
        expect(clockText(599.2)).toBe('10:00');
        expect(clockText(65)).toBe('1:05');
    });
});

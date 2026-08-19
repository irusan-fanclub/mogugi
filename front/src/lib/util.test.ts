import { describe, it, expect } from 'vitest';
import { humanReadableNumber, bossTargetLabel, bossTitleLabel, stackLayout } from './util';

describe('humanReadableNumber', () => {
    // Sub-thousand values still read in K, so a column never mixes a bare
    // number with a suffixed one.
    it('expresses a sub-1K number in K', () => {
        expect(humanReadableNumber(123)).toBe('0.12K');
        expect(humanReadableNumber(999)).toBe('1.00K');
        expect(humanReadableNumber(5)).toBe('0.01K');
    });

    it('writes an exact zero plainly', () => {
        expect(humanReadableNumber(0)).toBe('0K');
    });

    it('uses two decimals from 1K up', () => {
        expect(humanReadableNumber(1000)).toBe('1.00K');
        expect(humanReadableNumber(18_530)).toBe('18.53K');
    });

    it('keeps trailing zeros rather than shortening', () => {
        expect(humanReadableNumber(18_500)).toBe('18.50K');
        expect(humanReadableNumber(2_000_000)).toBe('2.00M');
    });

    it('uses M from a million and B from a billion', () => {
        expect(humanReadableNumber(12_340_000)).toBe('12.34M');
        expect(humanReadableNumber(1_234_000_000)).toBe('1.23B');
    });

    // Rounding decides the unit: 999,999 is 1000.00K, which is a million.
    it('promotes to the next unit when rounding carries', () => {
        expect(humanReadableNumber(999_999)).toBe('1.00M');
        expect(humanReadableNumber(999_999_999)).toBe('1.00B');
        expect(humanReadableNumber(999_994)).toBe('999.99K');
    });

    it('stays on B above a thousand billion rather than inventing a unit', () => {
        expect(humanReadableNumber(2_500_000_000_000)).toBe('2500.00B');
    });

    it('keeps the sign', () => {
        expect(humanReadableNumber(-18_530)).toBe('-18.53K');
    });

    it('renders zero for unusable input', () => {
        expect(humanReadableNumber(NaN)).toBe('0K');
        expect(humanReadableNumber(Infinity)).toBe('0K');
        expect(humanReadableNumber(undefined as unknown as number)).toBe('0K');
    });
});

describe('scheduleTrigger', () => {
    // One log held ~1,400 entities; per-instance timers fired ~1,400 separate
    // recompute cascades after load. The shared tick folds them into one.
    it('fires every distinct trigger once, in one batch', async () => {
        const { scheduleTrigger } = await import('./util');
        const calls: string[] = [];
        const a = () => calls.push('a');
        const b = () => calls.push('b');
        scheduleTrigger(a);
        scheduleTrigger(b);
        scheduleTrigger(a);   // repeat request must not double-fire
        expect(calls).toEqual([]);   // nothing until the tick
        await new Promise(r => setTimeout(r, 60));
        expect(calls.sort()).toEqual(['a', 'b']);
    });

    it('a request made during a flush lands in the next tick, not the same one', async () => {
        const { scheduleTrigger } = await import('./util');
        const calls: string[] = [];
        const again = () => calls.push('again');
        const first = () => { calls.push('first'); scheduleTrigger(again); };
        scheduleTrigger(first);
        await new Promise(r => setTimeout(r, 60));
        expect(calls).toEqual(['first']);
        await new Promise(r => setTimeout(r, 60));
        expect(calls).toEqual(['first', 'again']);
    });
});

describe('bossTargetLabel', () => {
    // 2026-08-13 21:58:45 local (UTC+8) = 1786888725
    const at = new Date('2026-08-13T21:58:45+08:00').getTime() / 1000;

    it('formats "time name (race) -- hp"', () => {
        expect(bossTargetLabel(at, 7601, '佩塔克 7601', 850368576))
            .toBe('2026-08-13 21:58:45 佩塔克 (7601) -- 850.37M');
    });

    it('omits missing time and hp, falls back on unknown race name', () => {
        expect(bossTargetLabel(undefined, 7601, undefined, undefined))
            .toBe('unknownRace:7601 (7601)');
    });

    it('keeps a race name that has no trailing id', () => {
        expect(bossTargetLabel(undefined, 7615, '雷楠的米勒：悔恨', 3449779200))
            .toBe('雷楠的米勒：悔恨 (7615) -- 3.45B');
    });
});

describe('stackLayout', () => {
    it('stacks blocks vertically at the widest width', () => {
        expect(stackLayout([{ w: 800, h: 300 }, { w: 600, h: 500 }]))
            .toEqual({ w: 800, h: 800, ys: [0, 300] });
    });

    it('inserts a gap between blocks but not after the last', () => {
        expect(stackLayout([{ w: 800, h: 300 }, { w: 600, h: 500 }], 32))
            .toEqual({ w: 800, h: 832, ys: [0, 332] });
        expect(stackLayout([{ w: 400, h: 200 }], 32)).toEqual({ w: 400, h: 200, ys: [0] });
    });

    it('handles a single block', () => {
        expect(stackLayout([{ w: 400, h: 200 }])).toEqual({ w: 400, h: 200, ys: [0] });
    });

    it('handles no blocks', () => {
        expect(stackLayout([])).toEqual({ w: 0, h: 0, ys: [] });
    });
});

describe('bossTitleLabel', () => {
    const at = new Date('2026-08-13T21:58:45+08:00').getTime() / 1000;

    it('formats "time name - hp" without the race id', () => {
        expect(bossTitleLabel(at, 7603, '雷楠的米勒 7603', 1967880064))
            .toBe('2026-08-13 21:58:45 雷楠的米勒 - 1.97B');
    });

    it('omits missing segments', () => {
        expect(bossTitleLabel(undefined, 7603, undefined, undefined))
            .toBe('unknownRace:7603');
    });
});

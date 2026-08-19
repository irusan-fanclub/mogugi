import { describe, it, expect } from 'vitest';
import { deriveMusicBuffCell, MUSIC_CC_IDS } from './musicBuff';

// history entries are [At, list of conditions]; helper keeps the tests readable.
const h = (at: number, ...ccs: Array<[number, string]>) => ({
    At: at,
    List: ccs.map(([CCId, v]) => ({ CCId, Params: { MCMBAMIN: v, LSMA: v } })),
} as never);

describe('deriveMusicBuffCell', () => {
    it('reports absent when no music condition ever appears', () => {
        expect(deriveMusicBuffCell([h(0), h(10)], 0, 10).kind).toBe('absent');
    });

    it('reports a single steady value with full coverage', () => {
        const c = deriveMusicBuffCell([h(0, [680, '32.2']), h(10, [680, '32.2'])], 0, 10);
        expect(c).toMatchObject({ kind: 'present', ccId: 680, firstPct: 32.2, lastPct: 32.2, songChanged: false, isOn: true });
        expect(c.kind === 'present' && c.coverage).toBe(1);
    });

    it('reports partial coverage when the buff lapsed', () => {
        const c = deriveMusicBuffCell([h(0, [680, '32.2']), h(5), h(10, [680, '32.2'])], 0, 10);
        expect(c.kind === 'present' && c.coverage).toBeCloseTo(0.5);
        expect(c.kind === 'present' && c.isOn).toBe(true);
    });

    it('reports both ends when the value changed', () => {
        const c = deriveMusicBuffCell([h(0, [680, '28.4']), h(5, [680, '32.2'])], 0, 10);
        expect(c).toMatchObject({ firstPct: 28.4, lastPct: 32.2, songChanged: false });
    });

    it('flags a song change and reports the current song only', () => {
        const c = deriveMusicBuffCell([h(0, [680, '32.2']), h(5, [192, '86.1'])], 0, 10);
        expect(c).toMatchObject({ ccId: 192, songChanged: true, lastPct: 86.1 });
    });

    it('reports off at the window end but keeps the last value', () => {
        const c = deriveMusicBuffCell([h(0, [680, '32.2']), h(5)], 0, 10);
        expect(c).toMatchObject({ isOn: false, lastPct: 32.2 });
    });

    it('handles a buff already on before the window starts', () => {
        const c = deriveMusicBuffCell([h(0, [680, '32.2'])], 5, 10);
        expect(c).toMatchObject({ kind: 'present', isOn: true });
    });

    it('returns absent for an empty history', () => {
        expect(deriveMusicBuffCell([], 0, 10).kind).toBe('absent');
    });

    it('covers exactly the two mutually-exclusive songs', () => {
        expect([...MUSIC_CC_IDS].sort()).toEqual([192, 680]);
    });

    it('does not credit on-time from before the window', () => {
        // On [0,3) and [6,∞) the buff is on, but only [5,10] is the window:
        // 1s off (5-6) + 4s on (6-10) out of 5s = 0.8, not the 7/5 the raw history implies.
        const c = deriveMusicBuffCell([h(0, [680, '10.0']), h(3), h(6, [680, '10.0'])], 5, 10);
        expect(c.kind === 'present' && c.coverage).toBeCloseTo(0.8);
    });

    it('ignores a song change that happened entirely before the window', () => {
        const c = deriveMusicBuffCell(
            [h(-100, [680, '10.0']), h(-50, [192, '20.0']), h(3, [192, '20.0'])], 0, 10,
        );
        expect(c).toMatchObject({ songChanged: false, firstPct: 20.0 });
    });
});

describe('value ranges', () => {
    // The row cell prints each value with the span it was in force, so the
    // range must end where the value changes — not where the state ends.
    it('carries when each value started and ended', () => {
        const c = deriveMusicBuffCell([h(0, [680, '28.4']), h(5, [680, '32.2'])], 0, 10);
        expect(c.kind === 'present' && c.firstRange).toEqual([0, 5]);
        expect(c.kind === 'present' && c.lastRange).toEqual([5, 10]);
    });

    it('extends a range across refreshes at the same value', () => {
        const c = deriveMusicBuffCell(
            [h(0, [680, '28.4']), h(3, [680, '28.4']), h(6, [680, '32.2'])], 0, 10);
        expect(c.kind === 'present' && c.firstRange).toEqual([0, 6]);
    });

    it('ends the last range where the music turned off', () => {
        const c = deriveMusicBuffCell([h(0, [680, '32.2']), h(7)], 0, 10);
        expect(c.kind === 'present' && c.lastRange).toEqual([0, 7]);
    });
});

describe('runs', () => {
    // 中斷後回到同一個數值是第二段演奏,不是同一段的延續 — 顯示要各帶時間。
    it('splits a run where the music lapsed, even at the same value', () => {
        const c = deriveMusicBuffCell([h(0, [680, '32.2']), h(4), h(6, [680, '32.2'])], 0, 10);
        expect(c.kind === 'present' && c.runs.map(r => r.range)).toEqual([[0, 4], [6, 10]]);
    });

    it('counts a third performance', () => {
        const c = deriveMusicBuffCell(
            [h(0, [680, '28.4']), h(3, [680, '32.2']), h(6, [680, '35.0'])], 0, 10);
        expect(c.kind === 'present' && c.runs).toHaveLength(3);
    });
});

describe('run merging across brief gaps', () => {
    it('a <=1s blip at the same value does not split the run', () => {
        const c = deriveMusicBuffCell(
            [h(0, [680, '92.3']), h(100), h(101, [680, '92.3']), h(200, [680, '92.3'])], 0, 300);
        expect(c.kind === 'present' && c.runs).toEqual([
            { ccId: 680, pct: 92.3, range: [0, 300] },
        ]);
    });

    it('an overlap re-apply (zero gap through an off state) merges too', () => {
        const c = deriveMusicBuffCell(
            [h(0, [680, '92.3']), h(100), h(100, [680, '92.3'])], 0, 300);
        expect(c.kind === 'present' && c.runs.length).toBe(1);
    });

    it('a >1s gap at the same value still splits', () => {
        const c = deriveMusicBuffCell(
            [h(0, [680, '92.3']), h(100), h(105, [680, '92.3'])], 0, 300);
        expect(c.kind === 'present' && c.runs.length).toBe(2);
    });

    it('a value change within 1s starts a new run', () => {
        const c = deriveMusicBuffCell(
            [h(0, [680, '92.3']), h(100), h(101, [680, '63.3'])], 0, 300);
        expect(c.kind === 'present' && c.runs.length).toBe(2);
    });
});

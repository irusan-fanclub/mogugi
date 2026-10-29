import { describe, it, expect } from 'vitest';
import { conditionOption } from './conditionOption';

const tokens: Record<string, string> = { '--c-line': 'L', '--c-series-1': 'A', '--c-series-2': 'B' };
type Opt = { series: { name: string; step: string; data: unknown; itemStyle: { color: string } }[]; yAxis: { min: number; max: number; axisLabel: { formatter: (v: number) => string } } };

describe('conditionOption', () => {
    const o = conditionOption({
        series: [{ name: 'a', points: [[1000, 1]] }, { name: 'b', points: [[1000, 0]] }], tokens,
    }) as unknown as Opt;
    it('draws one step series per attacker from the series tokens', () => {
        expect(o.series.map(s => s.name)).toEqual(['a', 'b']);
        expect(o.series.every(s => s.step === 'start')).toBe(true);
        expect(o.series.map(s => s.itemStyle.color)).toEqual(['A', 'B']);
    });
    it('labels the 0..1 axis OFF and ON', () => {
        expect([o.yAxis.min, o.yAxis.max]).toEqual([0, 1]);
        expect([0, 1].map(o.yAxis.axisLabel.formatter)).toEqual(['OFF', 'ON']);
    });
});

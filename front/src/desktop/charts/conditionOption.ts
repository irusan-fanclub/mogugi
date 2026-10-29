import type { EChartsCoreOption } from 'echarts/core';
import type { TimelineSeries } from '@/lib/conditionTimeline';

export interface ConditionOptionInput {
    series: TimelineSeries[];
    tokens: Record<string, string>;
}

const PALETTE = Array.from({ length: 12 }, (_, i) => `--c-series-${i + 1}`);
export const CONDITION_TOKENS = ['--c-text', '--c-text-dim', '--c-line', '--c-surface-2', ...PALETTE];

const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString('en-GB');

/** One ON/OFF step area per attacker over wall-clock time, with drag-zoom. */
export function conditionOption({ series, tokens: t }: ConditionOptionInput): EChartsCoreOption {
    return {
        animation: false,
        backgroundColor: 'transparent',
        grid: { left: 48, right: 16, top: 36, bottom: 28 },
        xAxis: {
            type: 'time',
            axisLine: { lineStyle: { color: t['--c-line'] } },
            axisLabel: { color: t['--c-text-dim'] },
            splitLine: { show: false },
        },
        yAxis: {
            type: 'value', min: 0, max: 1, interval: 1,
            splitLine: { lineStyle: { color: t['--c-line'] } },
            axisLabel: { color: t['--c-text-dim'], formatter: (v: number) => (v === 1 ? 'ON' : v === 0 ? 'OFF' : '') },
        },
        series: series.map((s, i) => {
            const color = t[PALETTE[i % PALETTE.length]];
            return {
                type: 'line', id: `s${i}`, name: s.name, data: s.points, step: 'start', symbol: 'none', animation: false,
                lineStyle: { color, width: 1.5 }, itemStyle: { color }, areaStyle: { color, opacity: 0.3 },
            };
        }),
        tooltip: {
            trigger: 'axis', confine: true,
            backgroundColor: t['--c-surface-2'], borderColor: t['--c-line'],
            textStyle: { color: t['--c-text'], fontSize: 12 },
            formatter: (raw: unknown) => {
                const ps = (Array.isArray(raw) ? raw : [raw]) as { marker: string; seriesName: string; value: [number, number] }[];
                if (ps.length === 0) return '';
                return `${fmtTime(ps[0].value[0])}<br/>${ps.map(p => `${p.marker} <b>${p.seriesName}</b>: ${p.value[1] === 1 ? 'ON' : 'OFF'}`).join('<br/>')}`;
            },
        },
        toolbox: {
            right: 16, top: 4, itemSize: 12,
            iconStyle: { borderColor: t['--c-text-dim'] },
            feature: { dataZoom: { yAxisIndex: 'none', xAxisIndex: 0, title: { zoom: '框選縮放', back: '還原縮放' } } },
        },
        dataZoom: [{ type: 'inside', xAxisIndex: 0, filterMode: 'none' }],
    };
}

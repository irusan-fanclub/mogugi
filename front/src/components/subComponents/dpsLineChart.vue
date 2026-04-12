<template>
    <div ref="chartDom" style="width: 100%;"></div>
</template>

<script lang="ts">
import { defineComponent, ref, PropType, onMounted, onUnmounted, watch } from 'vue';
import highcharts, { Options, SeriesLineOptions } from 'highcharts';
import type { EntityDamage } from '@/eventActor';
import { bucketDamages } from '@/lib/timeRangeFilter';
import { setTimeRange, clearTimeRange } from '@/store';

type ChartEntity = { name: string, damages: EntityDamage[] };

const PLAYER_COLORS = [
    '#FF6B6B', '#4ECDC4', '#FFD93D', '#A78BFA',
    '#F97316', '#22D3EE', '#F472B6', '#34D399',
    '#FB923C', '#818CF8', '#FBBF24', '#6EE7B7',
];

const UPDATE_INTERVAL_MS = 15_000;

export default defineComponent({
    props: {
        entities: { type: Array as PropType<ChartEntity[]>, required: true },
        binSeconds: { type: Number, default: 15 },
        chartHeight: { type: Number, default: 240 },
    },
    emits: ['timeRange'],
    setup(props, { emit }) {
        const chartDom = ref<HTMLElement>(undefined!);
        let chart: Highcharts.Chart | undefined;
        let updateTimer = 0;
        let lastEntityKeys = '';

        const buildSeries = (): SeriesLineOptions[] => {
            const tick = props.binSeconds;
            return props.entities.map((v, i) => {
                const bins = bucketDamages(v.damages, tick);
                if (bins.size === 0) return { type: 'line' as const, name: v.name, data: [] };
                const binTimes = [...bins.keys()].sort((a, b) => a - b);
                const data: [number, number][] = [];
                for (let t = binTimes[0]; t <= binTimes[binTimes.length - 1]; t += tick) {
                    data.push([t * 1000, bins.get(t) || 0]);
                }
                return {
                    type: 'line' as const, name: v.name, data,
                    color: PLAYER_COLORS[i % PLAYER_COLORS.length], lineWidth: 2,
                };
            });
        };

        const emitTimeRange = () => {
            let minAt = Infinity, maxAt = -Infinity;
            for (const e of props.entities) {
                for (const d of e.damages) {
                    if (d.At < minAt) minAt = d.At;
                    if (d.At > maxAt) maxAt = d.At;
                }
            }
            if (minAt < maxAt) emit('timeRange', minAt, maxAt);
        };

        const getOriginMs = (): number => {
            let min = Infinity;
            for (const e of props.entities) {
                for (const d of e.damages) { if (d.At < min) min = d.At; }
            }
            return min * 1000;
        };

        const fmtRelative = (ms: number, origin: number) => {
            const sec = Math.max(0, Math.floor((ms - origin) / 1000));
            return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
        };

        const buildChartOpt = (): Options => {
            const originMs = getOriginMs();
            return {
            lang: { locale: 'en' },
            title: { text: '' },
            chart: {
                backgroundColor: 'transparent',
                height: props.chartHeight,
                spacing: [8, 8, 0, 8],
                zooming: { type: 'x' },
                animation: false,
                events: {
                    selection(e): undefined {
                        if ((e as any).resetSelection) { clearTimeRange(); return; }
                        const xAxis = (e as any).xAxis?.[0];
                        if (xAxis) setTimeRange(xAxis.min / 1000, xAxis.max / 1000);
                    },
                },
            },
            legend: {
                enabled: true, align: 'left', verticalAlign: 'top',
                floating: true, x: 50, y: 0,
                backgroundColor: '#121212CC', borderRadius: 4, padding: 6,
                itemStyle: { color: '#ccc', fontSize: '11px' }, itemDistance: 12,
            },
            xAxis: {
                type: 'datetime',
                labels: {
                    style: { color: '#888' },
                    formatter() { return fmtRelative(this.value as number, originMs); },
                },
            },
            yAxis: { title: { text: '' }, gridLineColor: '#2a2a2a', labels: { style: { color: '#888' } } },
            tooltip: {
                shared: true, backgroundColor: '#1e1e1e', borderColor: '#3a3a3a',
                style: { color: '#e0e0e0' }, headerFormat: '',
                pointFormatter() {
                    const p = this as any;
                    return `<span style="color:${p.color}">\u25CF</span> ${p.series.name}: <b>${p.y?.toLocaleString('en')}</b><br/>`;
                },
            },
            plotOptions: { line: { marker: { enabled: false }, animation: false } },
            series: buildSeries(),
            credits: { enabled: false },
        }};

        const fullRebuild = () => {
            chart?.destroy();
            chart = undefined;
            if (chartDom.value && props.entities.length > 0) {
                chart = highcharts.chart(chartDom.value, buildChartOpt());
                emitTimeRange();
            }
            lastEntityKeys = props.entities.map(e => e.name).join(',');
        };

        // Throttled update: only rebuild every UPDATE_INTERVAL_MS during
        // active combat. If the entity list changes (new player appears),
        // do a full rebuild immediately.
        const scheduleUpdate = () => {
            const currentKeys = props.entities.map(e => e.name).join(',');
            if (currentKeys !== lastEntityKeys) {
                fullRebuild();
                return;
            }
            if (updateTimer) return;
            updateTimer = window.setTimeout(() => {
                updateTimer = 0;
                fullRebuild();
            }, UPDATE_INTERVAL_MS);
        };

        onMounted(fullRebuild);
        watch(() => props.entities, scheduleUpdate);
        onUnmounted(() => {
            if (updateTimer) clearTimeout(updateTimer);
            chart?.destroy();
        });

        return { chartDom };
    },
});
</script>

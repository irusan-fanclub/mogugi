<template>
    <v-sheet class="d-flex flex-column" style="height: 100%;">
        <v-sheet class="d-flex align-center pa-2 flex-shrink-0" style="gap: 12px;">
            <span>Total: {{ humanReadableNumber(totalDamage) }}</span>
            <span>Duration: {{ durationText }}</span>
        </v-sheet>
        <div ref="chartDom" style="flex: 1; min-height: 0;"></div>
    </v-sheet>
</template>

<script lang="ts">
import { defineComponent, ref, PropType, onMounted, onUnmounted, computed } from 'vue';
import highcharts, { Options, SeriesLineOptions } from 'highcharts';
import type { EntityDamage } from '@/eventActor';
import { humanReadableNumber, formatDuration, getMabiNameColor } from '@/lib/util';
import { bucketDamages } from '@/lib/timeRangeFilter';
import { setTimeRange, clearTimeRange } from '@/store';

type ChartEntity = { name: string, damages: EntityDamage[] };

export default defineComponent({
    props: {
        entities: {
            type: Array as PropType<ChartEntity[]>,
            required: true,
        },
        binSeconds: {
            type: Number,
            default: 15,
        },
    },
    setup(props) {
        const chartDom = ref<HTMLElement>(undefined!);
        let chart: Highcharts.Chart | undefined;

        const totalDamage = computed(() =>
            props.entities.reduce((sum, e) => sum + e.damages.reduce((s, d) => s + d.Damage, 0), 0));

        const durationText = computed(() => {
            let minAt = Infinity, maxAt = -Infinity;
            for (const e of props.entities) {
                for (const d of e.damages) {
                    if (d.At < minAt) minAt = d.At;
                    if (d.At > maxAt) maxAt = d.At;
                }
            }
            return formatDuration(maxAt > minAt ? maxAt - minAt : 0);
        });

        const buildSeries = (): SeriesLineOptions[] => {
            const tick = props.binSeconds;
            return props.entities.map(v => {
                const bins = bucketDamages(v.damages, tick);
                if (bins.size === 0) return { type: 'line' as const, name: v.name, data: [] };

                const binTimes = [...bins.keys()].sort((a, b) => a - b);
                const data: [number, number][] = [];
                for (let t = binTimes[0]; t <= binTimes[binTimes.length - 1]; t += tick) {
                    data.push([t * 1000, bins.get(t) || 0]);
                }
                return {
                    type: 'line' as const,
                    name: v.name,
                    data,
                    color: getMabiNameColor(v.name),
                };
            });
        };

        const buildChartOpt = (): Options => ({
            lang: { locale: 'en' },
            title: { text: '' },
            chart: {
                backgroundColor: 'transparent',
                zooming: { type: 'x' },
                events: {
                    selection(e): undefined {
                        if ((e as any).resetSelection) {
                            clearTimeRange();
                            return;
                        }
                        const xAxis = (e as any).xAxis?.[0];
                        if (xAxis) setTimeRange(xAxis.min / 1000, xAxis.max / 1000);
                    },
                },
            },
            legend: {
                enabled: true,
                itemStyle: { color: '#ccc', fontSize: '11px' },
            },
            xAxis: { type: 'datetime', labels: { style: { color: '#888' } } },
            yAxis: {
                title: { text: '' },
                gridLineColor: '#2a2a2a',
                labels: { style: { color: '#888' } },
            },
            tooltip: {
                shared: true,
                backgroundColor: '#1e1e1e',
                borderColor: '#3a3a3a',
                style: { color: '#e0e0e0' },
            },
            plotOptions: {
                line: { marker: { enabled: false } },
            },
            series: buildSeries(),
            credits: { enabled: false },
        });

        onMounted(() => {
            chart = highcharts.chart(chartDom.value, buildChartOpt());
        });

        onUnmounted(() => {
            chart?.destroy();
        });

        return { chartDom, totalDamage, durationText, humanReadableNumber };
    },
});
</script>

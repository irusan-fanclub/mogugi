<template>
    <v-sheet v-if="!target" class="pa-3 text-center text-medium-emphasis" style="font-size: 0.85em;">
        Select a target to see debuff timeline
    </v-sheet>
    <v-sheet v-else-if="rows.length === 0" class="pa-3 text-center text-medium-emphasis" style="font-size: 0.85em;">
        No tracked debuffs on this target.
    </v-sheet>
    <v-sheet v-else class="d-flex flex-column" style="overflow: hidden;">
        <!-- Stacked area chart (one band per CC) -->
        <div ref="chartDom" style="width: 100%;"></div>
        <!-- Coverage summary below -->
        <v-sheet class="d-flex align-center flex-shrink-0 flex-wrap" style="gap: 10px; padding: 4px 10px;">
            <span style="font-size: 0.75em; color: #666;">Coverage:</span>
            <span v-for="r in rows" :key="r.ccId" class="d-flex align-center" style="gap: 3px;">
                <img width="14" height="14"
                    :src="`/res/characterconditionimage/${region}/${r.ccId}/${r.ccId}.png`"
                    style="border-radius: 2px;" />
                <span :style="{ fontSize: '0.75em', fontWeight: '600', color: coverageColor(r.pct) }">
                    {{ r.pct.toFixed(1) }}%
                </span>
            </span>
        </v-sheet>
    </v-sheet>
</template>

<script lang="ts">
import { defineComponent, PropType, ref, computed, inject, onMounted, onUnmounted, watch, Ref } from 'vue';
import highcharts, { Options, SeriesAreaOptions } from 'highcharts';
import type { EntityActor, EntityConditionState } from '@/eventActor';
import { setTimeRange, clearTimeRange } from '@/store';

const TRACKED_CC_IDS: number[] = [
    323, 351, 426, 803, 1012, 1026, 1093, 1094,
    1138, 10001, 10002, 515, 598, 912, 1092,
];

const CC_MERGE_MAP: Record<number, number> = {
    913: 912,
};

const CC_COLORS = [
    '#7B68EE', '#FF6B6B', '#4ECDC4', '#FFD93D',
    '#FF8C42', '#98D8C8', '#E57373', '#81C784',
    '#BA68C8', '#4FC3F7', '#AED581', '#FFB74D',
    '#F06292', '#90A4AE', '#CE93D8',
];

function coverageColor(pct: number): string {
    if (pct >= 60) return '#66BB6A';
    if (pct >= 40) return '#FFD54F';
    return '#EF5350';
}

export default defineComponent({
    props: {
        target: { type: Object as PropType<EntityActor | null>, default: null },
        timeMin: { type: Number as PropType<number | null>, default: null },
        timeMax: { type: Number as PropType<number | null>, default: null },
    },
    setup(props) {
        const region = inject('region');
        const condNameMap = inject('condNameMap') as Ref<Record<number, string>>;
        const timeRangeMin = inject('timeRangeMin') as Ref<number | null>;
        const timeRangeMax = inject('timeRangeMax') as Ref<number | null>;

        const chartDom = ref<HTMLElement>(undefined!);
        let chart: highcharts.Chart | undefined;

        const history = computed((): EntityConditionState[] => {
            if (!props.target) return [];
            const h = props.target.conditionHistory;
            const s = timeRangeMin.value;
            const e = timeRangeMax.value;
            if (s !== null && e !== null) return h.filter(st => st.At >= s && st.At <= e);
            return h;
        });

        const getMergedIds = (ccId: number): number[] => {
            const aliases = Object.entries(CC_MERGE_MAP)
                .filter(([, canonical]) => canonical === ccId)
                .map(([alias]) => Number(alias));
            return [ccId, ...aliases];
        };

        const activeCCIds = computed(() => {
            const seen = new Set<number>();
            for (const st of history.value) {
                for (const c of st.List) {
                    seen.add(CC_MERGE_MAP[c.CCId] ?? c.CCId);
                }
            }
            return TRACKED_CC_IDS.filter(id => seen.has(id));
        });

        const computeMergedCoverage = (h: EntityConditionState[], ccId: number) => {
            const ids = getMergedIds(ccId);
            if (h.length < 2) return { totalSec: 0, onSec: 0 };
            const totalSec = h[h.length - 1].At - h[0].At;
            let onSec = 0;
            for (let i = 0; i < h.length - 1; i++) {
                if (h[i].List.some(c => ids.includes(c.CCId))) {
                    onSec += h[i + 1].At - h[i].At;
                }
            }
            return { totalSec, onSec };
        };

        const rows = computed(() =>
            activeCCIds.value.map(ccId => {
                const { totalSec, onSec } = computeMergedCoverage(history.value, ccId);
                const pct = totalSec > 0 ? (100 * onSec / totalSec) : 0;
                return { ccId, name: condNameMap.value[ccId]?.replace(/\s*\d+$/, '') ?? `CC ${ccId}`, pct };
            })
        );

        const buildChartOpt = (): Options => {
            const h = history.value;
            const ccIds = activeCCIds.value;
            if (h.length < 2 || ccIds.length === 0) {
                return { title: { text: '' }, series: [], credits: { enabled: false } };
            }

            const minTime = (props.timeMin ?? h[0].At) * 1000;
            const maxTime = (props.timeMax ?? h[h.length - 1].At) * 1000;
            const originMs = minTime;
            const fmtRelative = (ms: number) => {
                const sec = Math.max(0, Math.floor((ms - originMs) / 1000));
                return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
            };

            const n = ccIds.length;
            const gap = 2;
            const panelH = (100 - gap * (n - 1)) / n;

            const yAxes = ccIds.map((id, i) => ({
                title: {
                    text: `<img src="/res/characterconditionimage/${(region as any).value}/${id}/${id}.png" width="16" height="16" />`,
                    useHTML: true,
                    rotation: 0,
                    style: { fontSize: '10px' },
                },
                min: 0, max: 1,
                tickInterval: 1,
                labels: { enabled: false },
                gridLineColor: '#2a2a2a',
                top: `${(panelH + gap) * i}%`,
                height: `${panelH}%`,
                offset: 0,
            }));

            const series: SeriesAreaOptions[] = ccIds.map((ccId, i) => {
                const ids = getMergedIds(ccId);
                const data: [number, number][] = [];
                for (const st of h) {
                    const active = st.List.some(c => ids.includes(c.CCId)) ? 1 : 0;
                    data.push([st.At * 1000, active]);
                }
                return {
                    type: 'area',
                    name: condNameMap.value[ccId]?.replace(/\s*\d+$/, '') ?? `CC ${ccId}`,
                    data,
                    step: 'left',
                    yAxis: i,
                    color: CC_COLORS[i % CC_COLORS.length],
                    fillOpacity: 0.5,
                    lineWidth: 0,
                };
            });

            return {
                lang: { locale: 'en' },
                title: { text: '' },
                chart: {
                    backgroundColor: 'transparent',
                    height: Math.max(100, n * 24 + 30),
                    spacing: [4, 8, 4, 8],
                    animation: false,
                    zooming: { type: 'x' },
                    events: {
                        selection(e): undefined {
                            if ((e as any).resetSelection) { clearTimeRange(); return; }
                            const xAxis = (e as any).xAxis?.[0];
                            if (xAxis) setTimeRange(xAxis.min / 1000, xAxis.max / 1000);
                        },
                    },
                },
                xAxis: {
                    type: 'datetime',
                    min: minTime, max: maxTime,
                    labels: {
                        style: { color: '#888', fontSize: '10px' },
                        formatter() { return fmtRelative(this.value as number); },
                    },
                },
                yAxis: yAxes as any,
                legend: { enabled: false },
                tooltip: {
                    backgroundColor: '#1e1e1e',
                    borderColor: '#3a3a3a',
                    style: { color: '#e0e0e0' },
                    formatter() {
                        const p = this as any;
                        return `<b>${p.series.name}</b>: ${p.y === 1 ? 'ON' : 'OFF'}`;
                    },
                },
                plotOptions: {
                    area: { marker: { enabled: false }, animation: false, states: { hover: { lineWidthPlus: 0 } } },
                },
                series,
                credits: { enabled: false },
            };
        };

        let updateTimer = 0;
        const UPDATE_INTERVAL_MS = 15_000;

        const fullRebuild = () => {
            chart?.destroy();
            chart = undefined;
            if (chartDom.value && rows.value.length > 0) {
                chart = highcharts.chart(chartDom.value, buildChartOpt());
            }
        };

        const scheduleUpdate = () => {
            if (updateTimer) return;
            updateTimer = window.setTimeout(() => {
                updateTimer = 0;
                fullRebuild();
            }, UPDATE_INTERVAL_MS);
        };

        // Full rebuild on target change; throttled on data updates.
        watch(() => props.target, fullRebuild);
        watch([() => props.timeMin, () => props.timeMax, activeCCIds, history], scheduleUpdate);
        onMounted(fullRebuild);
        onUnmounted(() => {
            if (updateTimer) clearTimeout(updateTimer);
            chart?.destroy();
        });

        return { region, rows, chartDom, coverageColor };
    },
});
</script>

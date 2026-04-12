<template>
    <v-sheet v-if="!target" class="pa-4 text-center text-medium-emphasis" style="font-size: 0.85em;">
        Select a target to see debuff timeline
    </v-sheet>
    <v-sheet v-else-if="rows.length === 0" class="pa-4 text-center text-medium-emphasis" style="font-size: 0.85em;">
        No tracked debuffs. Configure via settings.
    </v-sheet>
    <v-sheet v-else class="d-flex flex-column" style="overflow: hidden;">
        <!-- Inline summary: icon + overall % -->
        <v-sheet class="d-flex align-center flex-shrink-0 flex-wrap" style="gap: 10px; padding: 6px 10px;">
            <span style="font-size: 0.8em; color: #888;">Debuff:</span>
            <span v-for="r in rows" :key="r.ccId" class="d-flex align-center" style="gap: 3px;">
                <img width="16" height="16"
                    :src="`/res/characterconditionimage/${region}/${r.ccId}/${r.ccId}.png`"
                    style="border-radius: 2px;" />
                <span :style="{ fontSize: '0.8em', fontWeight: '600', color: coverageColor(r.pct) }">
                    {{ r.pct.toFixed(1) }}%
                </span>
            </span>
        </v-sheet>
        <!-- Gantt-style timeline -->
        <div ref="chartDom" style="min-height: 0; width: 100%; height: 100%;"></div>
    </v-sheet>
</template>

<script lang="ts">
import { defineComponent, PropType, ref, computed, inject, onMounted, onUnmounted, watch, Ref } from 'vue';
import highcharts, { Options } from 'highcharts';
import type { EntityActor, EntityConditionState } from '@/eventActor';

// @ts-ignore -- xrange module augments Highcharts at runtime
import('highcharts/modules/xrange').then(m => m.default(highcharts));
import { computeCCCoverage, getCCTimelineSegments } from '@/lib/conditionCoverage';
import { setTimeRange, clearTimeRange } from '@/store';

const TRACKED_CC_IDS: number[] = [
    323, 351, 426, 803, 1012, 1026, 1093, 1094,
    1138, 10001, 10002, 515, 598, 912, 1092,
];

// CC IDs that should be merged into another ID for display purposes.
// Key = alias ID, Value = canonical ID that it merges into.
const CC_MERGE_MAP: Record<number, number> = {
    913: 912,
};

const CC_COLORS = [
    '#7B68EE', '#FF6B6B', '#4ECDC4', '#FFD93D',
    '#FF8C42', '#98D8C8', '#E57373', '#81C784',
    '#BA68C8', '#4FC3F7', '#AED581', '#FFB74D',
    '#F06292', '#90A4AE', '#CE93D8', '#A1887F',
];

function coverageColor(pct: number): string {
    if (pct >= 60) return '#66BB6A';
    if (pct >= 40) return '#FFD54F';
    return '#EF5350';
}

export default defineComponent({
    props: {
        target: { type: Object as PropType<EntityActor | null>, default: null },
        startTime: { type: Number as PropType<number | null>, default: null },
        endTime: { type: Number as PropType<number | null>, default: null },
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
            const s = props.startTime ?? timeRangeMin.value;
            const e = props.endTime ?? timeRangeMax.value;
            if (s !== null && e !== null) {
                return h.filter(st => st.At >= s && st.At <= e);
            }
            return h;
        });

        // Resolve merged CC IDs: for each canonical ID, collect all alias
        // IDs that should be treated as the same condition.
        const getMergedIds = (ccId: number): number[] => {
            const aliases = Object.entries(CC_MERGE_MAP)
                .filter(([, canonical]) => canonical === ccId)
                .map(([alias]) => Number(alias));
            return [ccId, ...aliases];
        };

        // Filter tracked CCs to those that actually appear in the history
        // (including merged aliases).
        const activeCCIds = computed(() => {
            const seen = new Set<number>();
            for (const st of history.value) {
                for (const c of st.List) {
                    const canonical = CC_MERGE_MAP[c.CCId] ?? c.CCId;
                    seen.add(canonical);
                }
            }
            return TRACKED_CC_IDS.filter(id => seen.has(id));
        });

        // Compute coverage treating merged IDs as one condition.
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
                return { ccId, name: condNameMap.value[ccId] ?? `CC ${ccId}`, pct };
            })
        );

        const buildChartOpt = (): Options => {
            const h = history.value;
            if (h.length < 2 || activeCCIds.value.length === 0) {
                return { title: { text: '' }, series: [], credits: { enabled: false } };
            }

            const minTime = h[0].At;
            const maxTime = h[h.length - 1].At;
            const categories = activeCCIds.value.map(
                id => condNameMap.value[id] ?? `CC ${id}`
            );

            const seriesData: { x: number, x2: number, y: number, color: string }[] = [];

            activeCCIds.value.forEach((ccId, rowIdx) => {
                // Merge segments from all alias IDs (e.g. 912 + 913)
                const ids = getMergedIds(ccId);
                const allSegments: { start: number, end: number }[] = [];
                for (const id of ids) {
                    allSegments.push(...getCCTimelineSegments(h, id));
                }
                // Sort and merge overlapping segments
                allSegments.sort((a, b) => a.start - b.start);
                const merged: { start: number, end: number }[] = [];
                for (const seg of allSegments) {
                    const last = merged[merged.length - 1];
                    if (last && seg.start <= last.end) {
                        last.end = Math.max(last.end, seg.end);
                    } else {
                        merged.push({ ...seg });
                    }
                }

                const color = CC_COLORS[rowIdx % CC_COLORS.length];
                for (const seg of merged) {
                    seriesData.push({
                        x: seg.start * 1000,
                        x2: seg.end * 1000,
                        y: rowIdx,
                        color,
                    });
                }
            });

            return {
                lang: { locale: 'en' },
                title: { text: '' },
                chart: {
                    type: 'xrange',
                    backgroundColor: 'transparent',
                    height: Math.max(120, activeCCIds.value.length * 28 + 60),
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
                xAxis: {
                    type: 'datetime',
                    min: minTime * 1000,
                    max: maxTime * 1000,
                    labels: { style: { color: '#888' } },
                },
                yAxis: {
                    categories,
                    reversed: true,
                    gridLineColor: '#2a2a2a',
                    labels: { style: { color: '#aaa', fontSize: '10px' } },
                    title: { text: '' },
                },
                legend: { enabled: false },
                tooltip: {
                    backgroundColor: '#1e1e1e',
                    borderColor: '#3a3a3a',
                    style: { color: '#e0e0e0' },
                    pointFormatter() {
                        const p = this as any;
                        const start = new Date(p.x).toLocaleTimeString('en');
                        const end = new Date(p.x2).toLocaleTimeString('en');
                        const dur = ((p.x2 - p.x) / 1000).toFixed(1);
                        return `${start} — ${end} (${dur}s)`;
                    },
                },
                plotOptions: {
                    xrange: {
                        borderRadius: 2,
                        borderWidth: 0,
                        pointPadding: 0.1,
                        groupPadding: 0,
                    },
                },
                series: [{
                    type: 'xrange',
                    name: 'Active',
                    data: seriesData,
                }],
                credits: { enabled: false },
            };
        };

        const rebuildChart = () => {
            chart?.destroy();
            if (chartDom.value && rows.value.length > 0) {
                chart = highcharts.chart(chartDom.value, buildChartOpt());
            }
        };

        onMounted(rebuildChart);

        watch([() => props.target, activeCCIds, history], rebuildChart);

        onUnmounted(() => { chart?.destroy(); });

        return { region, rows, chartDom, coverageColor };
    },
});
</script>

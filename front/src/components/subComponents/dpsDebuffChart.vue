<template>
    <v-sheet v-if="entities.length === 0 && !target" class="pa-3 text-center text-medium-emphasis" style="font-size: 0.85em;">
        No combat data yet
    </v-sheet>
    <v-sheet v-else class="d-flex flex-column" style="overflow: hidden;">
        <div ref="dpsChartDom" style="width: 100%;"></div>
        <div v-if="chartCCIds.length > 0" ref="debuffChartDom" style="width: 100%;"></div>
        <v-sheet v-if="coverageStrips.some(s => s.rows.length > 0)"
            class="d-flex flex-column flex-shrink-0" style="padding: 4px 10px; gap: 2px;">
            <div v-for="(strip, i) in coverageStrips" :key="i" v-show="strip.rows.length > 0"
                class="d-flex align-center flex-wrap" style="gap: 10px;">
                <span :style="{ fontSize: '0.75em', minWidth: '64px', color: strip.label ? '#666' : 'transparent' }">Coverage:</span>
                <span v-for="r in strip.rows" :key="r.ccId" class="d-flex align-center"
                    :title="ccName(condNameMap, r.ccId) + ' ' + r.ccId" style="gap: 3px;">
                    <img width="14" height="14" :src="ccIconUrl(region, r.ccId)" style="border-radius: 2px;" />
                    <span :style="{
                        fontSize: '0.75em', fontWeight: '600', color: coverageColor(r.pct),
                        width: '3.5em', textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                    }">{{ r.pct.toFixed(1) }}%</span>
                </span>
            </div>
        </v-sheet>
    </v-sheet>
</template>

<script lang="ts">
import { defineComponent, PropType, ref, computed, inject, onMounted, onUnmounted, watch, Ref, nextTick } from 'vue';
import highcharts, { Options, SeriesLineOptions, SeriesAreaOptions } from 'highcharts';
import type { EntityDamage, EntityActor, EntityConditionState } from '@/eventActor';
import { bucketDamages } from '@/lib/timeRangeFilter';
import { getCCTimelineSegments } from '@/lib/conditionCoverage';
import { setTimeRange, clearTimeRange } from '@/store';
import { ccIconUrl, ccName } from '@/lib/util';

type ChartEntity = { name: string, damages: EntityDamage[] };

const PLAYER_COLORS = [
    '#FF6B6B', '#4ECDC4', '#FFD93D', '#A78BFA',
    '#F97316', '#22D3EE', '#F472B6', '#34D399',
    '#FB923C', '#818CF8', '#FBBF24', '#6EE7B7',
];

const CC_MERGE_MAP: Record<number, number> = { 913: 912, 504: 392, 1094: 1093 };
const CC_COLORS = [
    '#EF5350', '#7B68EE', '#FF6B6B', '#4ECDC4', '#FFD93D',
    '#FF8C42', '#98D8C8', '#E57373', '#81C784',
    '#BA68C8', '#4FC3F7', '#AED581', '#FFB74D',
    '#F06292', '#90A4AE', '#CE93D8', '#A1887F',
    '#80CBC4', '#FFAB91', '#B39DDB',
];

// Fixed left margin for both charts so their plot areas align.
const CHART_MARGIN_LEFT = 50;

function coverageColor(pct: number): string {
    if (pct >= 60) return '#66BB6A';
    if (pct >= 40) return '#FFD54F';
    return '#EF5350';
}

const UPDATE_INTERVAL_MS = 250;

export default defineComponent({
    props: {
        entities: { type: Array as PropType<ChartEntity[]>, required: true },
        target: { type: Object as PropType<EntityActor | null>, default: null },
        binSeconds: { type: Number, default: 15 },
        trackedCCIds: { type: Array as PropType<number[]>, default: () => [] },
        chartHiddenCCIds: { type: Array as PropType<number[]>, default: () => [] },
    },
    setup(props) {
        const region = inject('region') as Ref<string>;
        const condNameMap = inject('condNameMap') as Ref<Record<number, string>>;
        const timeRangeMin = inject('timeRangeMin') as Ref<number | null>;
        const timeRangeMax = inject('timeRangeMax') as Ref<number | null>;

        const dpsChartDom = ref<HTMLElement>(undefined!);
        const debuffChartDom = ref<HTMLElement>(undefined!);
        let dpsChart: highcharts.Chart | undefined;
        let debuffChart: highcharts.Chart | undefined;
        let updateTimer = 0;
        let lastEntityKeys = '';
        let lastActiveKey = '';

        const fightStart = computed(() => {
            let min = Infinity;
            for (const e of props.entities) {
                for (const d of e.damages) { if (d.At < min) min = d.At; }
            }
            return isFinite(min) ? min : 0;
        });

        const globalMaxMs = computed(() => {
            let max = -Infinity;
            const origin = fightStart.value;
            for (const e of props.entities) {
                for (const d of e.damages) {
                    const rel = (d.At - origin) * 1000;
                    if (rel > max) max = rel;
                }
            }
            const h = history.value;
            if (h.length > 0) {
                const rel = (h[h.length - 1].At - origin) * 1000;
                if (rel > max) max = rel;
            }
            return isFinite(max) ? max : 0;
        });

        const getMergedIds = (ccId: number): number[] => {
            const aliases = Object.entries(CC_MERGE_MAP)
                .filter(([, c]) => c === ccId).map(([a]) => Number(a));
            return [ccId, ...aliases];
        };

        const history = computed((): EntityConditionState[] => {
            if (!props.target) return [];
            const h = props.target.conditionHistory;
            const s = timeRangeMin.value, e = timeRangeMax.value;
            if (s !== null && e !== null) return h.filter(st => st.At >= s && st.At <= e);
            // Vue 3.4+ computed short-circuits on Object.is — actor pushes
            // _conditionHistory in place, so we must hand back a new array
            // ref or downstream computeds never invalidate.
            return h.slice();
        });

        const activeCCIds = computed(() => {
            const seen = new Set<number>();
            for (const st of history.value) {
                for (const c of st.List) seen.add(CC_MERGE_MAP[c.CCId] ?? c.CCId);
            }
            return props.trackedCCIds.filter(id => seen.has(id));
        });

        const chartCCIds = computed(() => {
            const hidden = new Set(props.chartHiddenCCIds);
            return activeCCIds.value.filter(id => !hidden.has(id));
        });

        // Coverage % for every tracked CC; un-seen CCs render at 0% so
        // the user can tell which tracked debuffs are missing.
        const coverageStrips = computed(() => {
            const h = history.value;
            const fightEndAt = fightStart.value + globalMaxMs.value / 1000;
            const total = h.length > 0 ? Math.max(0, fightEndAt - h[0].At) : 0;
            const hidden = new Set(props.chartHiddenCCIds);
            const chart: { ccId: number, pct: number }[] = [];
            const cov: { ccId: number, pct: number }[] = [];
            for (const ccId of props.trackedCCIds) {
                const ids = getMergedIds(ccId);
                let on = 0;
                if (h.length > 0 && total > 0) {
                    for (let i = 0; i < h.length; i++) {
                        const segEnd = i + 1 < h.length ? h[i + 1].At : fightEndAt;
                        if (h[i].List.some(c => ids.includes(c.CCId))) on += segEnd - h[i].At;
                    }
                }
                const row = { ccId, pct: total > 0 ? (100 * on / total) : 0 };
                (hidden.has(ccId) ? cov : chart).push(row);
            }
            return [{ label: true, rows: chart }, { label: false, rows: cov }];
        });

        const fmtRelative = (ms: number) => {
            const sec = Math.max(0, Math.floor(ms / 1000));
            return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
        };

        // --- Crosshair sync via a shared overlay line ---
        // Highcharts' drawCrosshair API is unreliable across separate
        // chart instances. Instead, we manually position a thin div as
        // the synced crosshair line over the target chart.
        let syncLineEl: HTMLDivElement | null = null;

        const ensureSyncLine = (): HTMLDivElement => {
            if (syncLineEl) return syncLineEl;
            syncLineEl = document.createElement('div');
            syncLineEl.style.cssText = 'position:absolute;top:0;bottom:0;width:1px;background:rgba(255,255,255,0.2);pointer-events:none;z-index:10;display:none;';
            return syncLineEl;
        };

        const setupHoverSync = () => {
            if (!dpsChartDom.value || !debuffChartDom.value) return;
            const line = ensureSyncLine();

            const onMove = (e: MouseEvent, source: 'dps' | 'debuff') => {
                const srcDom = (source === 'dps' ? dpsChartDom : debuffChartDom).value!;
                const tgtDom = (source === 'dps' ? debuffChartDom : dpsChartDom).value;
                if (!tgtDom) return;

                // Both charts have identical marginLeft and xAxis range,
                // so the pixel X relative to container is the same.
                const srcRect = srcDom.getBoundingClientRect();
                const pixelX = e.clientX - srcRect.left;

                if (!line.parentElement) tgtDom.style.position = 'relative';
                if (line.parentElement !== tgtDom) tgtDom.appendChild(line);
                line.style.left = `${pixelX}px`;
                line.style.display = '';
            };

            const onLeave = () => {
                if (syncLineEl) syncLineEl.style.display = 'none';
            };

            dpsChartDom.value.addEventListener('mousemove', (e) => onMove(e, 'dps'));
            dpsChartDom.value.addEventListener('mouseleave', onLeave);
            debuffChartDom.value.addEventListener('mousemove', (e) => onMove(e, 'debuff'));
            debuffChartDom.value.addEventListener('mouseleave', onLeave);
        };

        // --- DPS chart ---
        const buildDpsOpt = (): Options => {
            const origin = fightStart.value;
            const tick = props.binSeconds;
            const maxMs = globalMaxMs.value;

            // Rolling window: slide by 1 second, sum damage in [t, t+window).
            const stride = 1;
            const window = tick;

            const series: SeriesLineOptions[] = props.entities.map((v, i) => {
                if (v.damages.length === 0) return { type: 'line' as const, name: v.name, data: [] };

                // Sort damages by relative time
                const sorted = v.damages.map(d => ({ rel: d.At - origin, dmg: d.Damage }))
                    .sort((a, b) => a.rel - b.rel);
                const maxRel = sorted[sorted.length - 1].rel;

                const data: [number, number][] = [];
                let winStart = 0; // pointer into sorted[]
                let winEnd = 0;
                let winSum = 0;

                for (let t = 0; t <= maxRel; t += stride) {
                    // Expand right edge: include damages where rel < t + window
                    while (winEnd < sorted.length && sorted[winEnd].rel < t + window) {
                        winSum += sorted[winEnd].dmg;
                        winEnd++;
                    }
                    // Shrink left edge: exclude damages where rel < t
                    while (winStart < sorted.length && sorted[winStart].rel < t) {
                        winSum -= sorted[winStart].dmg;
                        winStart++;
                    }
                    data.push([t * 1000, winSum]);
                }
                return {
                    type: 'line' as const, name: v.name, data,
                    color: PLAYER_COLORS[i % PLAYER_COLORS.length], lineWidth: 2,
                };
            });

            return {
                lang: { locale: 'en' },
                title: { text: '' },
                chart: {
                    backgroundColor: 'transparent', height: 240,
                    marginLeft: CHART_MARGIN_LEFT,
                    spacing: [8, 8, 0, 8], animation: false,
                    zooming: { type: 'x' },
                    events: {
                        selection(e): undefined {
                            if ((e as any).resetSelection) {
                                clearTimeRange();
                                debuffChart?.xAxis[0].setExtremes(undefined, undefined, true, false);
                                return;
                            }
                            const xa = (e as any).xAxis?.[0];
                            if (xa) {
                                setTimeRange(origin + xa.min / 1000, origin + xa.max / 1000);
                                debuffChart?.xAxis[0].setExtremes(xa.min, xa.max, true, false);
                            }
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
                    type: 'linear', min: 0, max: maxMs > 0 ? maxMs : undefined,
                    crosshair: { color: '#ffffff33', width: 1 },
                    labels: {
                        style: { color: '#888' },
                        formatter() { return fmtRelative(this.value as number); },
                    },
                },
                yAxis: { title: { text: '' }, min: 0, gridLineColor: '#2a2a2a', labels: { style: { color: '#888' } } },
                tooltip: {
                    shared: true, backgroundColor: '#1e1e1e', borderColor: '#3a3a3a',
                    style: { color: '#e0e0e0' }, headerFormat: '',
                    pointFormat: '<span style="color:{series.color}">\u25CF</span> {series.name}: <b>{point.y:,.0f}</b><br/>',
                },
                plotOptions: { line: { marker: { enabled: false }, animation: false } },
                series, credits: { enabled: false },
            };
        };

        // --- Debuff chart ---
        const buildDebuffOpt = (): Options => {
            const origin = fightStart.value;
            const ccIds = chartCCIds.value;
            const h = history.value;
            const maxMs = globalMaxMs.value;
            if (h.length < 2 || ccIds.length === 0) {
                return { title: { text: '' }, series: [], credits: { enabled: false } };
            }

            const n = ccIds.length;
            const gap = 2;
            const panelH = (100 - gap * (n - 1)) / n;

            const yAxes = ccIds.map((id, i) => ({
                title: {
                    text: `<img src="${ccIconUrl(region.value, id)}" width="16" height="16" style="vertical-align:middle" />`,
                    useHTML: true, rotation: 0,
                },
                min: 0, max: 1, tickInterval: 1,
                labels: { enabled: false },
                gridLineColor: '#2a2a2a',
                top: `${(panelH + gap) * i}%`,
                height: `${panelH}%`,
                offset: 0,
            }));

            const series: SeriesAreaOptions[] = ccIds.map((ccId, idx) => {
                const ids = getMergedIds(ccId);
                const data: [number, number][] = [];
                let lastActive = 0;
                for (const st of h) {
                    lastActive = st.List.some(c => ids.includes(c.CCId)) ? 1 : 0;
                    data.push([(st.At - origin) * 1000, lastActive]);
                }
                // _conditionHistory only grows on set-membership change,
                // so the last point lags during refresh-only periods —
                // pin the still-active bar to the chart's right edge.
                if (lastActive === 1 && data.length > 0) {
                    data.push([maxMs, 1]);
                }
                const color = CC_COLORS[idx % CC_COLORS.length];
                return {
                    type: 'area' as const,
                    name: ccName(condNameMap.value, ccId),
                    data, step: 'left' as const, yAxis: idx,
                    color, fillOpacity: 0.5, lineWidth: 0, showInLegend: false,
                    marker: {
                        enabled: false,
                        states: {
                            hover: {
                                enabled: true,
                                radius: 4,
                                lineWidth: 0,
                            },
                        },
                    },
                };
            });

            return {
                lang: { locale: 'en' },
                title: { text: '' },
                chart: {
                    backgroundColor: 'transparent',
                    height: n * 16 + 4,
                    marginLeft: CHART_MARGIN_LEFT,
                    spacing: [0, 8, 0, 8], animation: false,
                    zooming: { type: 'x' },
                    events: {
                        selection(e): undefined {
                            if ((e as any).resetSelection) {
                                clearTimeRange();
                                dpsChart?.xAxis[0].setExtremes(undefined, undefined, true, false);
                                return;
                            }
                            const xa = (e as any).xAxis?.[0];
                            if (xa) {
                                setTimeRange(fightStart.value + xa.min / 1000, fightStart.value + xa.max / 1000);
                                dpsChart?.xAxis[0].setExtremes(xa.min, xa.max, true, false);
                            }
                        },
                    },
                },
                xAxis: {
                    type: 'linear', min: 0, max: maxMs > 0 ? maxMs : undefined,
                    crosshair: { color: '#ffffff33', width: 1 },
                    labels: { enabled: false }, // shared with DPS chart's xAxis above
                    lineWidth: 0, tickLength: 0,
                },
                yAxis: yAxes as any,
                legend: { enabled: false },
                tooltip: {
                    shared: true, backgroundColor: '#1e1e1e', borderColor: '#3a3a3a',
                    style: { color: '#e0e0e0' }, headerFormat: '',
                    pointFormatter() {
                        const p = this as any;
                        const on = p.y === 1;
                        const color = on ? p.color : '#555';
                        return `<span style="color:${color}; font-size:10px;">\u25CF</span> ${p.series.name}<br/>`;
                    },
                },
                plotOptions: {
                    area: { animation: false, states: { hover: { lineWidthPlus: 0 } } },
                },
                series, credits: { enabled: false },
            };
        };

        const fullRebuild = () => {
            dpsChart?.destroy(); dpsChart = undefined;
            debuffChart?.destroy(); debuffChart = undefined;

            nextTick(() => {
                if (dpsChartDom.value && props.entities.length > 0) {
                    dpsChart = highcharts.chart(dpsChartDom.value, buildDpsOpt());
                }
                if (debuffChartDom.value && chartCCIds.value.length > 0) {
                    debuffChart = highcharts.chart(debuffChartDom.value, buildDebuffOpt());
                }
                setupHoverSync();
            });
            lastEntityKeys = props.entities.map(e => e.name).join(',');
            lastActiveKey = chartCCIds.value.join(',');
        };

        // In-place data refresh: setData + setExtremes on existing charts,
        // no destroy/recreate. Bails to fullRebuild on series-count mismatch
        // since yAxis layout depends on it.
        const updateData = () => {
            if (!dpsChart && !debuffChart) { fullRebuild(); return; }
            const newDpsSeries = (buildDpsOpt().series ?? []) as SeriesLineOptions[];
            const newDebuffSeries = (buildDebuffOpt().series ?? []) as SeriesAreaOptions[];
            if (dpsChart && newDpsSeries.length !== dpsChart.series.length) { fullRebuild(); return; }
            if (debuffChart && newDebuffSeries.length !== debuffChart.series.length) { fullRebuild(); return; }

            const maxMs = globalMaxMs.value;
            const apply = (chart: highcharts.Chart, series: { data?: unknown }[]) => {
                if (maxMs > 0) chart.xAxis[0].setExtremes(0, maxMs, false, false);
                for (let i = 0; i < series.length; i++) {
                    if (series[i].data) chart.series[i].setData(series[i].data as [number, number][], false, false);
                }
                chart.redraw(false);
            };
            if (dpsChart) apply(dpsChart, newDpsSeries);
            if (debuffChart) apply(debuffChart, newDebuffSeries);
        };

        const scheduleUpdate = () => {
            const keys = props.entities.map(e => e.name).join(',');
            const activeKey = chartCCIds.value.join(',');
            if (keys !== lastEntityKeys || activeKey !== lastActiveKey) {
                lastActiveKey = activeKey;
                fullRebuild();
                return;
            }
            if (updateTimer) return;
            updateTimer = window.setTimeout(() => { updateTimer = 0; updateData(); }, UPDATE_INTERVAL_MS);
        };

        onMounted(fullRebuild);
        watch(() => props.target, fullRebuild);
        watch(() => props.trackedCCIds, fullRebuild);
        watch(() => props.chartHiddenCCIds, fullRebuild);
        watch(() => props.entities, scheduleUpdate);
        watch([activeCCIds, chartCCIds, history], scheduleUpdate);
        onUnmounted(() => {
            if (updateTimer) clearTimeout(updateTimer);
            dpsChart?.destroy(); debuffChart?.destroy();
        });

        return { region, condNameMap, dpsChartDom, debuffChartDom, chartCCIds, coverageStrips, coverageColor, ccIconUrl, ccName };
    },
});
</script>

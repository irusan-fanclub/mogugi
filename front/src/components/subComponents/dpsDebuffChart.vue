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
                        width: '2.8em', textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                    }">{{ fmtPct(r.pct) }}</span>
                </span>
            </div>
        </v-sheet>
    </v-sheet>
</template>

<script lang="ts">
import { defineComponent, PropType, ref, computed, inject, onMounted, onUnmounted, watch, Ref, nextTick } from 'vue';
import highcharts, { Options, SeriesLineOptions, SeriesAreaOptions, PointOptionsObject } from 'highcharts';
import type { ActorManager, EntityDamage, EntityActor, EntityConditionState } from '@/eventActor';
import { computeCCCoverage, clipToWindow } from '@/lib/conditionCoverage';
import { rollingDamageSeries } from '@/lib/dpsSeries';
import { setTimeRange, clearTimeRange, hiddenTrackIds } from '@/store';
import { ccIconUrl, ccName } from '@/lib/util';
import { ccTrackId, PLAYER_SIDE_CC_IDS } from '@/lib/buffTrack';
import { CC_PARAMS_TOOLTIP } from '@/lib/ccConditionTooltip';
import { mergeConditionHistories } from '@/lib/mergeConditions';
import { buildBardsongConditionHistory } from '@/lib/bardsongTrack';

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

// 100% drops the decimal so it fits the same column width as "99.9%".
function fmtPct(pct: number): string {
    let s = pct.toFixed(1);
    if (s === '100.0') s = '100';
    return s + '%';
}

const UPDATE_INTERVAL_MS = 250;

// Per-series point cap for the DPS lines; see the stride note in buildDpsOpt.
const MAX_POINTS_PER_SERIES = 800;

export default defineComponent({
    props: {
        entities: { type: Array as PropType<ChartEntity[]>, required: true },
        target: { type: Object as PropType<EntityActor | null>, default: null },
        binSeconds: { type: Number, default: 15 },
        /** Party members, for the player-side tracks — see PLAYER_SIDE_CC_IDS. */
        partyActors: { type: Array as PropType<EntityActor[]>, default: () => [] },
        trackedCCIds: { type: Array as PropType<number[]>, default: () => [] },
        chartHiddenCCIds: { type: Array as PropType<number[]>, default: () => [] },
    },
    setup(props) {
        const region = inject('region') as Ref<string>;
        const condNameMap = inject('condNameMap') as Ref<Record<number, string>>;
        const timeRangeMin = inject('timeRangeMin') as Ref<number | null>;
        const timeRangeMax = inject('timeRangeMax') as Ref<number | null>;
        const actorManager = inject('actorManager') as Ref<ActorManager>;

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
            // Deliberately damage-only. Party members' condition histories span
            // the whole loaded log, not this fight, so letting a CC extend the
            // axis stretched it to a later fight's 覺醒 or bard song.
            return isFinite(max) ? max : 0;
        });

        const fightEndAt = computed(() => fightStart.value + globalMaxMs.value / 1000);

        const getMergedIds = (ccId: number): number[] => {
            const aliases = Object.entries(CC_MERGE_MAP)
                .filter(([, c]) => c === ccId).map(([a]) => Number(a));
            return [ccId, ...aliases];
        };

        const mergedHistory = computed((): EntityConditionState[] => {
            // Vue 3.4+ computed short-circuits on Object.is, and the actor
            // pushes _conditionHistory in place — merge always builds a new
            // array, so downstream computeds still invalidate.
            //
            // bardsongEvents is spread here (not just passed by reference) so
            // this computed reads its index/length — required for it to
            // invalidate when ActorManager pushes to the shallowReactive array.
            return mergeConditionHistories([
                { history: props.target?.conditionHistory ?? [] },
                ...props.partyActors.map(a => ({
                    history: a.conditionHistory,
                    ccIds: PLAYER_SIDE_CC_IDS,
                })),
                { history: buildBardsongConditionHistory([...actorManager.value.bardsongEvents]) },
            ]);
        });

        // Zoom-restricted view for the chart. Coverage math must not use this:
        // a naive At-range filter drops whatever state was already active at
        // the zoom's start, which is exactly the bug computeCCCoverage now
        // guards against — see coverageStrips below.
        const history = computed((): EntityConditionState[] => {
            // Scoped to the fight first: the merge's party and bard-song sources
            // run the length of the loaded log. Clipping seeds the fight's start
            // with whatever was already active, so a pre-fight buff still shows.
            const merged = clipToWindow(mergedHistory.value, fightStart.value, fightEndAt.value);
            const s = timeRangeMin.value, e = timeRangeMax.value;
            if (s !== null && e !== null) return merged.filter(st => st.At >= s && st.At <= e);
            return merged;
        });

        // Player-side CCs are tracked alongside the target's debuffs; each one
        // still answers to its own hiddenTrackIds toggle.
        const trackedCCIdsEffective = computed(() => {
            const extra = PLAYER_SIDE_CC_IDS.filter(id =>
                !hiddenTrackIds.value.has(ccTrackId(id)) && !props.trackedCCIds.includes(id));
            const hidden = PLAYER_SIDE_CC_IDS.filter(id => hiddenTrackIds.value.has(ccTrackId(id)));
            return [...props.trackedCCIds.filter(id => !hidden.includes(id)), ...extra];
        });

        const activeCCIds = computed(() => {
            const seen = new Set<number>();
            for (const st of history.value) {
                for (const c of st.List) seen.add(CC_MERGE_MAP[c.CCId] ?? c.CCId);
            }
            return trackedCCIdsEffective.value.filter(id => seen.has(id));
        });

        const chartCCIds = computed(() => {
            const hidden = new Set(props.chartHiddenCCIds);
            return activeCCIds.value.filter(id => !hidden.has(id));
        });

        // Coverage % for every tracked CC; un-seen CCs render at 0% so
        // the user can tell which tracked debuffs are missing.
        const coverageStrips = computed(() => {
            // The fight's own bounds, not the (possibly narrower, possibly
            // absent) zoom range — coverage always reflects the whole fight.
            const h = mergedHistory.value;
            const hidden = new Set(props.chartHiddenCCIds);
            const chart: { ccId: number, pct: number }[] = [];
            const cov: { ccId: number, pct: number }[] = [];
            for (const ccId of trackedCCIdsEffective.value) {
                // Player-side rows show at 0% like any other tracked CC now
                // that the settings menu carries them (the eye dismisses them).
                const { totalSec, onSec } = computeCCCoverage(h, getMergedIds(ccId), fightStart.value, fightEndAt.value);
                const row = { ccId, pct: totalSec > 0 ? (100 * onSec / totalSec) : 0 };
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
        // Native Highcharts sync: both charts snap to the same axis value, so
        // the crosshairs agree (a free-floating line cannot — each chart's own
        // crosshair snaps to its nearest point), and the mirrored tooltip
        // rides along for free.
        let hoverSyncInstalled = false;
        // Points our synthetic tooltip.refresh put into hover state, per
        // chart. pointer.reset() only clears chart.hoverPoint(s) — mirrored
        // points aren't in that list, so their halos survive every reset
        // (the "stuck hover" was these halos).
        const mirrorPts = new WeakMap<highcharts.Chart, highcharts.Point[]>();
        const mirrorHover = (src?: highcharts.Chart, tgt?: highcharts.Chart, ev?: MouseEvent) => {
            if (!src || !tgt || !ev) return;
            const norm = src.pointer.normalize(ev);
            const xVal = src.xAxis[0].toValue(norm.chartX);
            const tev = {
                chartX: tgt.xAxis[0].toPixels(xVal, false),
                chartY: tgt.plotTop + tgt.plotHeight / 2,
            } as unknown as PointerEvent;
            if (!isFinite((tev as unknown as { chartX: number }).chartX)) {
                clearMirror(tgt);
                return;
            }
            const pts: highcharts.Point[] = [];
            for (const sr of tgt.series) {
                if (!sr.visible) continue;
                const pt = (sr as unknown as { searchPoint(e: unknown, x: boolean): highcharts.Point | undefined })
                    .searchPoint(tev, true);
                if (pt) pts.push(pt);
            }
            // No point found (hovered x beyond this chart's data, or its
            // series are empty): clear instead of returning, or the last
            // mirrored tooltip/crosshair stays frozen on the plot.
            if (!pts.length) {
                clearMirror(tgt);
                return;
            }
            const tooltip = tgt.tooltip as unknown as { refresh(p: highcharts.Point | highcharts.Point[]): void; shared?: boolean };
            const prev = mirrorPts.get(tgt);
            if (prev) {
                for (const p of prev) {
                    if (!pts.includes(p)) try { p.setState(''); } catch { /* point gone */ }
                }
            }
            tooltip.refresh((tgt.tooltip as unknown as { options: { shared?: boolean } }).options.shared ? pts : pts[0]);
            tgt.xAxis[0].drawCrosshair(tev as never, pts[0]);
            mirrorPts.set(tgt, pts);
            mirrorActive = true;
        };
        const clearMirror = (tgt?: highcharts.Chart) => {
            if (!tgt) return;
            // Swallow per-chart failures (mid-rebuild states) so one chart's
            // cleanup can never abort the other's.
            try {
                const pts = mirrorPts.get(tgt);
                if (pts) {
                    mirrorPts.delete(tgt);
                    for (const p of pts) try { p.setState(''); } catch { /* point gone */ }
                }
                for (const sr of tgt.series) {
                    (sr as unknown as { halo?: { hide(): void } }).halo?.hide();
                }
                (tgt.pointer as unknown as { reset(allowMove?: boolean, delay?: number): void })?.reset(false, 0);
                tgt.tooltip?.hide(0);
                (tgt.xAxis[0] as unknown as { hideCrosshair(): void }).hideCrosshair();
            } catch { /* chart being torn down */ }
        };
        const clearBothMirrors = () => {
            mirrorActive = false;
            clearMirror(dpsChart);
            clearMirror(debuffChart);
        };
        // Backstop: mouseleave alone proved unreliable (hovers stayed stuck
        // after crossing between the charts), so any document-level move
        // outside both containers force-clears while a mirror is showing.
        let mirrorActive = false;
        const onDocMove = (e: MouseEvent) => {
            if (!mirrorActive) return;
            const t = e.target as Node | null;
            if (t && (dpsChartDom.value?.contains(t) || debuffChartDom.value?.contains(t))) return;
            clearBothMirrors();
        };

        const setupHoverSync = () => {
            // The two container divs survive fullRebuild, so listeners attach
            // once and read the current chart instances through the closures.
            if (hoverSyncInstalled || !dpsChartDom.value || !debuffChartDom.value) return;
            hoverSyncInstalled = true;
            dpsChartDom.value.addEventListener('mousemove', e => mirrorHover(dpsChart, debuffChart, e));
            debuffChartDom.value.addEventListener('mousemove', e => mirrorHover(debuffChart, dpsChart, e));
            // Leaving either chart clears both: the source chart's own
            // hover would otherwise stay stuck (mouseleave only cleared
            // the mirrored side).
            for (const dom of [dpsChartDom.value, debuffChartDom.value]) {
                dom.addEventListener('mouseleave', clearBothMirrors);
            }
            document.addEventListener('mousemove', onDocMove);
        };

        // --- DPS chart ---
        const buildDpsOpt = (): Options => {
            const origin = fightStart.value;
            const tick = props.binSeconds;
            const maxMs = globalMaxMs.value;

            // One point per second is 15x oversampling of a 15-second mean, and
            // the cost is paid on hover: the shared tooltip hit-tests every
            // point of every series. A 50-minute log with 14 players is 42,000
            // of them. Short fights and zoomed ranges still get every second.
            const stride = Math.max(1, Math.ceil(maxMs / 1000 / MAX_POINTS_PER_SERIES));

            // The window is centred on each point (see lib/dpsSeries.ts) so the
            // curve lines up with the debuff lanes, which use exact event times.
            const series: SeriesLineOptions[] = props.entities.map((v, i) => ({
                type: 'line' as const, name: v.name,
                data: rollingDamageSeries(v.damages, origin, tick, stride),
                color: PLAYER_COLORS[i % PLAYER_COLORS.length], lineWidth: 2,
            }));

            return {
                lang: { locale: 'en' },
                title: { text: '' },
                chart: {
                    backgroundColor: 'transparent', height: 190,
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
            // This early return carries no chart.height, so Highcharts would
            // fall back to 400px — an empty panel. A single state still
            // renders (a running song pins its bar to the right edge).
            if (h.length === 0 || ccIds.length === 0) {
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
                const formatter = CC_PARAMS_TOOLTIP[ccId];
                const data: PointOptionsObject[] = [];
                let lastActive = 0;
                // The matched condition's own Params. Segment end tracks the
                // CC's actual DISABLE (List membership), never a param like SBT.
                let lastParams: Record<string, string> | undefined;
                for (const st of h) {
                    const match = st.List.find(c => ids.includes(c.CCId));
                    lastActive = match ? 1 : 0;
                    lastParams = match?.Params;
                    const point: PointOptionsObject = { x: (st.At - origin) * 1000, y: lastActive };
                    if (formatter) point.custom = { params: lastParams };
                    data.push(point);
                }
                // _conditionHistory only grows on set-membership change,
                // so the last point lags during refresh-only periods —
                // pin the still-active bar to the chart's right edge.
                if (lastActive === 1 && data.length > 0) {
                    const point: PointOptionsObject = { x: maxMs, y: 1 };
                    if (formatter) point.custom = { params: lastParams };
                    data.push(point);
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
                        const dot = `<span style="color:${color}; font-size:10px;">\u25CF</span>`;
                        // No applier/caster is rendered here by design: CC 516's
                        // element carries 0, not the caster (spec section 12), and
                        // the generic label below never had an attribution field.
                        const formatter = on ? CC_PARAMS_TOOLTIP[ccIds[p.series.index as number]] : undefined;
                        const text = formatter ? formatter(p.options?.custom?.params ?? {}) : null;
                        return text
                            ? `${dot} ${p.series.name}: ${text}<br/>`
                            : `${dot} ${p.series.name}<br/>`;
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
        // By content, not identity: an identity watch on an array prop fires on
        // every parent render, and fullRebuild destroys both charts — that
        // combination once rebuilt them ~13x/s for the whole session.
        watch(() => props.trackedCCIds.join(','), fullRebuild);
        watch(() => props.chartHiddenCCIds.join(','), fullRebuild);
        watch(() => props.entities, scheduleUpdate);
        watch([activeCCIds, chartCCIds, history], scheduleUpdate);
        onUnmounted(() => {
            if (updateTimer) clearTimeout(updateTimer);
            document.removeEventListener('mousemove', onDocMove);
            dpsChart?.destroy(); debuffChart?.destroy();
        });

        return { region, condNameMap, dpsChartDom, debuffChartDom, chartCCIds, coverageStrips, coverageColor, fmtPct, ccIconUrl, ccName };
    },
});
</script>

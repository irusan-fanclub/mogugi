import type { EChartsCoreOption } from 'echarts/core';
import { placeRulerLabels, type HpMark } from '@/lib/hpRuler';

export interface TimelineEntity { name: string; points: [number, number][] }
// colorIndex: the CC's place in the tracked lists, so a CC keeps its colour whether or not its lane shows.
export interface TimelineLane { ccId: number; name: string; icon: string; points: [number, 0 | 1][]; ticks: number[]; colorIndex?: number }
export interface TimelineInput {
    entities: TimelineEntity[];
    lanes: TimelineLane[];
    selfLanes: TimelineLane[];
    selfTitle: string;
    // The 自身 ＋ is shown with no self lanes: label and divider go in the reserved row.
    reserveSelfRow?: boolean;
    invincible: [number, number][];   // ms since origin
    maxMs: number;
    tokens: Record<string, string>;
    // Rolling DPS over every player's hits combined; absent hides the party line.
    partyPoints?: [number, number][];
    // Boss HP at ms since origin, for the tooltip; independent of the ruler marks.
    hpAt?: (ms: number) => number | null;
    // Legend selection to restore (ECharts resets it on setOption); 隊伍總和 is off unless set.
    legendSelected?: Record<string, boolean>;
    // Boss HP ruler marks; absent when the boss never crosses a step. guideStep (default 25, 0 = none)
    // picks the marks whose dashed guide runs down through every lane; band false hides the ruler itself.
    ruler?: { marks: HpMark[]; originSec: number; guideStep?: number; band?: boolean };
}

export const PARTY_NAME = '隊伍總和';
export const SERIES_COUNT = 12;
export const LANE_COLOR_COUNT = 16;
// Coprime with LANE_COLOR_COUNT: the first 16 indices get 16 different colours, neighbours far apart on the wheel.
const LANE_COLOR_STEP = 7;
export const TIMELINE_TOKENS = [
    '--c-text', '--c-text-dim', '--c-line', '--c-accent', '--c-surface', '--c-surface-2',
    '--c-ruler-band', '--c-ruler-tick', '--c-ruler-tick-major', '--c-ruler-text', '--c-ruler-text-major',
    ...Array.from({ length: LANE_COLOR_COUNT }, (_, i) => `--c-lane-${i + 1}`), '--c-lane-grid',
    ...Array.from({ length: SERIES_COUNT }, (_, i) => `--c-series-${i + 1}`),
];

export const MAX_POINTS = 800;
const LEFT = 50;            // shared plot left edge so every grid aligns
const RIGHT = 8;
const DPS_TOP = 52;         // room for title, legend and the HP ruler above the plot
const DPS_H = 190;
const LANE_TOP_GAP = 28;    // x-axis labels sit between the DPS plot and the first lane
const AXIS_TICK_LEN = 5;
const LANE_H = 16;          // lanes sit edge to edge; each lane's top axis line rules it off from the row above
const BOTTOM_PAD = 8;
export const ICON_W = 16;
export const ICON_GAP = 4;          // right-aligned name: icon's right edge is this far left of the plot
// Group labels are centred just left of the icon column (icon left edge = LEFT - ICON_GAP - ICON_W).
export const GROUP_LABEL_X = LEFT - ICON_GAP - ICON_W - 2 - 5;
// Left edge of the lane icons; the coverage strip's icons start here too.
export const ICON_LEFT = LEFT - ICON_GAP - ICON_W;
export const GROUP_LABEL_FONT = 9;
const INVINCIBLE_RED = '#e5534b';
export const INVINCIBLE_NAME = '無敵';
const TICK_WHITE = '#ffffff';
const RULER_BAND_H = 12;     // band sits just above the plot, ticks rise from its bottom edge
const RULER_GAP = 3;
const RULER_MIN_LABEL_GAP = 30;

// Top of the k-th lane overall, boss lanes first; the group counts are kept for the callers' shape.
const slotTop = (k: number, _bossCount: number, _selfCount: number) => DPS_TOP + DPS_H + LANE_TOP_GAP + k * LANE_H;

// Top of the row just below the last lane (or below the x-axis labels when there are none).
const rowAfter = (n: number, _bossCount: number, _selfCount: number) => DPS_TOP + DPS_H + LANE_TOP_GAP + n * LANE_H;

// reserveSelfRow adds a row for the 自身 ＋ when that group has no lanes.
export function dpsTimelineHeight(laneCount: number, selfCount = 0, reserveSelfRow = false): number {
    const n = laneCount + selfCount;
    if (reserveSelfRow && selfCount === 0) return rowAfter(n, laneCount, 0) + LANE_H + BOTTOM_PAD;
    return n === 0 ? DPS_TOP + DPS_H + LANE_TOP_GAP : slotTop(n - 1, laneCount, selfCount) + LANE_H + BOTTOM_PAD;
}

// Top (px in the chart) of each lane's icon, boss lanes first; the icon is as tall as the lane.
export function laneIconTops(B: number, S: number): number[] {
    return Array.from({ length: B + S }, (_, k) => slotTop(k, B, S));
}

export const PLUS_W = 16;
export const PLUS_H = 16;
export const PLUS_LEFT = 2;   // left of the group label column (label centre GROUP_LABEL_X)

// Top (px in the chart) of each group's ＋: centred on the group's lanes like its label; an
// empty group gets the free row below the lanes (boss: the x-axis label band when no lanes).
export function plusTops(B: number, S: number): { boss: number; self: number } {
    const n = B + S;
    const centreOf = (a: number, b: number) => (slotTop(a, B, S) + slotTop(b, B, S) + LANE_H - PLUS_H) / 2;
    const boss = B > 0 ? centreOf(0, B - 1) : DPS_TOP + DPS_H + (LANE_TOP_GAP - PLUS_H) / 2;
    const self = S > 0 ? centreOf(B, n - 1) : rowAfter(B, B, 0) + (LANE_H - PLUS_H);
    return { boss, self };
}

export function fmtMmSs(ms: number): string {
    const sec = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

// Axis ticks are round numbers, so one optional decimal is enough to stay short.
export function fmtAxisCompact(v: number): string {
    const a = Math.abs(v);
    const trim = (x: number) => String(+x.toFixed(1));
    if (a >= 1e6) return trim(v / 1e6) + 'M';
    if (a >= 1e3) return trim(v / 1e3) + 'K';
    return trim(v);
}

// Callers already stride the DPS lines; this is the backstop. Keeps the last point.
function cap<T>(points: T[]): T[] {
    if (points.length <= MAX_POINTS) return points;
    const k = Math.ceil(points.length / MAX_POINTS);
    const out = points.filter((_, i) => i % k === 0);
    const last = points[points.length - 1];
    if (out[out.length - 1] !== last) {
        if (out.length >= MAX_POINTS) out.pop();
        out.push(last);
    }
    return out;
}

type Api = { coord(v: number[]): number[]; getWidth(): number };
type Params = { dataIndex: number; coordSys: { x: number; width: number } };

// Band, ticks and labels are drawn in pixels but placed by data x, so zoom and resize need no rebuild.
function hpRulerSeries(ruler: NonNullable<TimelineInput['ruler']>, t: Record<string, string>, overlay: number) {
    const { marks, originSec } = ruler;
    const ms = (m: HpMark) => (m.at - originSec) * 1000;
    const bandTop = DPS_TOP - RULER_GAP - RULER_BAND_H;
    const renderItem = (params: Params, api: Api) => {
        const { x: left, width } = params.coordSys;
        const inView = (x: number) => x >= left && x <= left + width;
        const xs = marks.map(m => ({ pct: m.pct, x: api.coord([ms(m), 0])[0] })).filter(m => inView(m.x));
        const shown = placeRulerLabels(xs, RULER_MIN_LABEL_GAP);
        const m = marks[params.dataIndex];
        const x = api.coord([ms(m), 0])[0];
        const children: Record<string, unknown>[] = params.dataIndex === 0 ? [{
            type: 'rect', shape: { x: left, y: bandTop, width, height: RULER_BAND_H, r: 2 }, style: { fill: t['--c-ruler-band'] },
        }] : [];
        if (inView(x)) {
            const big = m.pct % 25 === 0;
            children.push({
                type: 'line', shape: { x1: x, x2: x, y1: DPS_TOP - RULER_GAP, y2: DPS_TOP - (big ? 15 : 9) },
                style: { stroke: big ? t['--c-ruler-tick-major'] : t['--c-ruler-tick'], lineWidth: 1 },
            });
            if (shown.has(m.pct)) children.push({
                type: 'text',
                style: {
                    text: String(m.pct), x: x + 3, y: DPS_TOP - 4, textVerticalAlign: 'bottom',
                    fill: big ? t['--c-ruler-text-major'] : t['--c-ruler-text'],
                    font: `${big ? 600 : 400} 9.5px sans-serif`,
                },
            });
        }
        return { type: 'group', $mergeChildren: false, children };
    };
    return [
        ...(ruler.band === false ? [] : [{
            type: 'custom' as const, id: 'hpRuler', xAxisIndex: 0, yAxisIndex: 0, silent: true, animation: false,
            coordinateSystem: 'cartesian2d', clip: false, tooltip: { show: false },
            encode: { x: 0, y: 1 }, data: marks.map(m => [ms(m), 0, m.pct]), renderItem,
        }]),
        ...(guideMarks(ruler).length === 0 ? [] : [{
            // On the overlay grid, so a guide runs from the plot down through the BOSS and 自身 lanes.
            type: 'line' as const, id: 'hpRulerLines', xAxisIndex: overlay, yAxisIndex: overlay, data: [], silent: true, animation: false,
            markLine: {
                silent: true, symbol: 'none', animation: false, label: { show: false },
                lineStyle: { color: t['--c-ruler-tick-major'], width: 1, type: [3, 4], opacity: 0.35 },
                data: guideMarks(ruler).map(m => ({ xAxis: ms(m) })),
            },
        }]),
    ];
}

function guideMarks(ruler: TimelineInput['ruler']): HpMark[] {
    const step = ruler?.guideStep ?? 25;
    return ruler && step > 0 ? ruler.marks.filter(m => m.pct % step === 0) : [];
}

export function dpsTimelineOption(input: TimelineInput): EChartsCoreOption {
    const { entities, legendSelected, lanes: bossLanes, selfLanes, selfTitle, reserveSelfRow, invincible, maxMs, tokens: t, ruler, partyPoints, hpAt } = input;
    const color = (i: number) => t[`--c-series-${(i % SERIES_COUNT) + 1}`];
    const laneColor = (k: number) => t[`--c-lane-${(((all[k].colorIndex ?? k) * LANE_COLOR_STEP) % LANE_COLOR_COUNT) + 1}`];
    const B = bossLanes.length;
    const S = selfLanes.length;
    const all = [...bossLanes, ...selfLanes];
    const laneId = (l: TimelineLane, k: number) => (k < B ? `lane:${l.ccId}` : `lane:self:${l.ccId}`);
    const axes = [0, ...all.map((_, i) => i + 1)];
    const max = maxMs > 0 ? maxMs : undefined;
    const hasBoxes = invincible.length > 0;
    // Full-height grid under the invincible boxes and the HP guides, when either is present.
    const hasOverlay = hasBoxes || guideMarks(ruler).length > 0;
    const overlay = all.length + 1;

    // 'none' stops ECharts 6 from shrinking a grid whose labels overflow, which would misalign the lanes.
    const box = { left: LEFT, right: RIGHT, outerBoundsMode: 'none' as const };
    const plotBottom = all.length > 0 ? slotTop(all.length - 1, B, S) + LANE_H : DPS_TOP + DPS_H;
    const grid = [
        { ...box, top: DPS_TOP, height: DPS_H },
        ...all.map((_, k) => ({ ...box, top: slotTop(k, B, S), height: LANE_H })),
        ...(hasOverlay ? [{ ...box, top: DPS_TOP, height: plotBottom - DPS_TOP }] : []),
    ];
    const xAxis = [
        ...axes.map(i => ({
            type: 'value' as const, gridIndex: i, min: 0, max,
            // A lane's axis sits on its top edge: the rule above every lane (none under the last), and the
            // first lane carries the time ticks.
            // z above the series, so a full-height fill never covers the rule.
            ...(i === 0 ? {} : { position: 'top' as const, z: 3 }),
            axisLine: { show: true, onZero: false, lineStyle: { color: i === 0 ? t['--c-line'] : t['--c-lane-grid'] } },
            // The plot's ticks point down and the first lane's point up, same length and colour.
            axisTick: { show: i <= 1, length: AXIS_TICK_LEN, lineStyle: { color: t['--c-line'] } },
            splitLine: { show: false },
            axisLabel: i === 0
                // Edge labels align inward so the last one is not clipped by the chart edge.
                // Centred in the band between the plot and the first lane.
                ? {
                    color: t['--c-text-dim'], formatter: (v: number) => fmtMmSs(v), alignMinLabel: 'left' as const, alignMaxLabel: 'right' as const,
                    margin: LANE_TOP_GAP / 2, verticalAlign: 'middle' as const,
                }
                : { show: false },
        })),
        ...(hasOverlay ? [{ type: 'value' as const, gridIndex: overlay, min: 0, max, show: false }] : []),
    ];
    const yAxis = [
        {
            type: 'value' as const, gridIndex: 0, min: 0,
            splitLine: { lineStyle: { color: t['--c-line'] } },
            axisLabel: { color: t['--c-text-dim'], formatter: fmtAxisCompact },
        },
        ...all.map((l, i) => ({
            // 0..1 exactly, so an active CC fills its whole row.
            type: 'value' as const, gridIndex: i + 1, min: 0, max: 1, interval: 1,
            axisLabel: { show: false }, axisTick: { show: false },
            axisLine: { show: false }, splitLine: { show: false },
            // The icon is the lane's label; rich images load lazily and repaint.
            name: '{i|}', nameLocation: 'middle' as const, nameRotate: 0, nameGap: ICON_GAP,
            nameTextStyle: { align: 'right' as const, rich: { i: { height: ICON_W, width: ICON_W, backgroundColor: { image: l.icon } } } },
        })),
        ...(hasOverlay ? [{ type: 'value' as const, gridIndex: overlay, min: 0, max: 1, show: false }] : []),
    ];

    const rulerSeries = ruler && ruler.marks.length > 0 ? hpRulerSeries(ruler, t, overlay) : [];

    const hasParty = entities.length > 0 && partyPoints !== undefined;
    const series = [
        ...entities.map((e, i) => ({
            type: 'line' as const, id: `dps:${i}`, name: e.name, xAxisIndex: 0, yAxisIndex: 0,
            data: cap(e.points), symbol: 'none', animation: false,
            lineStyle: { color: color(i), width: 2 }, itemStyle: { color: color(i) },
        })),
        ...(!hasParty ? [] : [{
            // Rolling DPS of all players' hits combined; the legend keeps it hidden until clicked.
            type: 'line' as const, id: 'party', name: PARTY_NAME, xAxisIndex: 0, yAxisIndex: 0,
            data: cap(partyPoints!), symbol: 'none', animation: false,
            lineStyle: { color: t['--c-text-dim'], width: 1, type: 'dashed' as const }, itemStyle: { color: t['--c-text-dim'] },
        }]),
        ...all.map((l, i) => ({
            type: 'line' as const, id: laneId(l, i), name: l.name, xAxisIndex: i + 1, yAxisIndex: i + 1,
            data: cap(l.points), step: 'end' as const, symbol: 'none', animation: false,
            lineStyle: { width: 0 }, itemStyle: { color: laneColor(i) },
            areaStyle: { color: laneColor(i), opacity: 0.6 },
            // As tall as the bar, and under the lane rule (axis z 3; markLine defaults to z 5).
            markLine: {
                silent: true, symbol: 'none', animation: false, label: { show: false }, z: 2,
                lineStyle: { color: TICK_WHITE, width: 1, type: 'solid' as const, opacity: 0.45 },
                data: l.ticks.map(x => ({ xAxis: x })),
            },
        })),
        ...(hasBoxes ? [{
            // Empty carrier for the markArea; markArea ignores itemStyle.decal in ECharts 6, so plain fill.
            type: 'line' as const, id: 'invincible', xAxisIndex: overlay, yAxisIndex: overlay,
            data: [], silent: true, animation: false,
            // A faint tint through plot and lanes; the legend's 無敵 item shows or hides it.
            name: INVINCIBLE_NAME, itemStyle: { color: INVINCIBLE_RED }, lineStyle: { color: INVINCIBLE_RED },
            markArea: {
                silent: true, animation: false,
                itemStyle: { color: 'rgba(229, 83, 75, 0.12)', borderWidth: 0 },
                data: invincible.map(([a, b]) => [{ xAxis: a }, { xAxis: b }]),
            },
        }] : []),
        ...rulerSeries,
    ];

    // Each group is named by a rotated label left of its icons, so no extra row is needed.
    const showSelf = S > 0 || reserveSelfRow === true;
    // Latin reads rotated; CJK stacks upright so two characters fit a single 16px lane.
    const groupLabel = (text: string, first: number, count: number, fill: string) => {
        const latin = /^[ -~]*$/.test(text);
        // An empty group has no lanes, so its label sits in the one reserved row.
        const y = count > 0
            ? (slotTop(first, B, S) + slotTop(first + count - 1, B, S) + LANE_H) / 2
            : rowAfter(B, B, 0) + LANE_H / 2;
        // Groups touch, so a label must fit its own rows: shrink it for a one- or two-lane group
        // (CJK stacks one glyph per line; rotated Latin runs about 0.65em per letter).
        const room = Math.max(1, count) * LANE_H;
        const fit = latin ? room / (0.65 * text.length) : room / [...text].length;
        const size = Math.max(6, Math.min(GROUP_LABEL_FONT, Math.floor(fit)));
        return {
            type: 'text' as const, silent: true, z: 100, rotation: latin ? Math.PI / 2 : 0,
            x: GROUP_LABEL_X, y,
            style: {
                text: latin ? text : [...text].join('\n'), fill, fontSize: size, lineHeight: size,
                align: 'center' as const, verticalAlign: 'middle' as const,
            },
        };
    };
    const graphic = [
        ...(B > 0 ? [groupLabel('BOSS', 0, B, t['--c-text-dim'])] : []),
        ...(showSelf ? [groupLabel(selfTitle, B, S, t['--c-accent'])] : []),
    ];

    // Lanes keep only their switches, so the nearest point the tooltip gets is not the state: look it up.
    const laneById = new Map(all.map((l, k) => [laneId(l, k), l.points]));
    const laneOnAt = (id: string, ms: number) => {
        let on = 0;
        for (const [x, v] of laneById.get(id) ?? []) { if (x > ms) break; on = v; }
        return on === 1;
    };
    const xAxisIndex = hasOverlay ? [...axes, overlay] : axes;
    return {
        animation: false,
        backgroundColor: 'transparent',
        title: {
            text: 'DPS（每 15 秒）與狀態時間軸', left: LEFT, top: 0,
            textStyle: { color: t['--c-text-dim'], fontSize: 12, fontWeight: 'normal' },
        },
        legend: {
            data: entities.length === 0 ? [] : [
                ...entities.map(e => e.name), ...(hasParty ? [PARTY_NAME] : []),
                ...(hasBoxes ? [{ name: INVINCIBLE_NAME, icon: 'rect', itemStyle: { color: 'rgba(229, 83, 75, 0.45)' } }] : []),
            ],
            selectedMode: true,
            selected: entities.length === 0 ? {} : {
                ...legendSelected,
                [PARTY_NAME]: legendSelected?.[PARTY_NAME] ?? false,
                [INVINCIBLE_NAME]: legendSelected?.[INVINCIBLE_NAME] ?? true,
            },
            left: LEFT, top: 20,
            itemWidth: 14, itemHeight: 8, itemGap: 12,
            textStyle: { color: t['--c-text'], fontSize: 11 },
            inactiveColor: t['--c-text-dim'],
        },
        grid, xAxis, yAxis, series, graphic,
        axisPointer: [{ link: [{ xAxisIndex: axes }], lineStyle: { color: t['--c-text-dim'] } }],
        tooltip: {
            trigger: 'axis',
            confine: true,
            backgroundColor: t['--c-surface-2'], borderColor: t['--c-line'],
            textStyle: { color: t['--c-text'], fontSize: 12 },
            axisPointer: { type: 'line', lineStyle: { color: t['--c-text-dim'] } },
            formatter: (raw: unknown) => {
                const ps = (Array.isArray(raw) ? raw : [raw]) as {
                    seriesId: string; seriesName: string; marker: string; value: [number, number]; axisValue: number;
                }[];
                if (ps.length === 0) return '';
                const rows = ps.filter(p => /^(dps|lane):|^party$/.test(p.seriesId)).map(p => p.seriesId.startsWith('lane:')
                    ? `${p.marker} ${p.seriesName}${laneOnAt(p.seriesId, ps[0].axisValue ?? p.value[0]) ? '' : '（未啟用）'}`
                    : `${p.marker} ${p.seriesName}: <b>${Math.round(p.value[1]).toLocaleString('en-US')}</b>`);
                const ms = ps[0].axisValue ?? ps[0].value[0];
                const hp = hpAt?.(ms);
                // Nothing but the overlay hovered and no HP to show: no tooltip.
                if (rows.length === 0 && hp == null) return '';
                const head = [`<b>${fmtMmSs(ms)}</b>`, ...(hp != null ? [`<b>BOSS 血量 ${hp.toFixed(1)}%</b>`] : [])];
                return [...head, ...rows].join('<br/>');
            },
        },
        toolbox: {
            right: RIGHT, top: 0, itemSize: 12,
            iconStyle: { borderColor: t['--c-text-dim'] },
            feature: {
                dataZoom: { yAxisIndex: 'none', xAxisIndex, title: { zoom: '框選縮放', back: '還原縮放' } },
            },
        },
        // Plain wheel scrolls the page; Ctrl+wheel zooms, drag still pans.
        dataZoom: [{ type: 'inside', xAxisIndex, filterMode: 'none', zoomOnMouseWheel: 'ctrl', moveOnMouseWheel: false }],
    };
}

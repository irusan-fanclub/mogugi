<script lang="ts">
import { ref as sharedRef } from 'vue';

// One ＋ popover open at a time across components.
const openPlus = sharedRef<{ owner: symbol; group: 'boss' | 'self'; strip: boolean } | null>(null);
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { EntityActor, EntityConditionState } from '@/eventActor';
import {
    actorManager, condNameMap, hpGuideStep, isBossRace, showCastTicks, showHpRuler, showInvincible, region, setTimeRange, clearTimeRange, timeRangeMin, timeRangeMax,
} from '@/store';
import { clipToWindow } from '@/lib/conditionCoverage';
import { ccValueSummaries, type CcValueSummary } from '@/lib/ccValues';
import { rollingDamageSeries } from '@/lib/dpsSeries';
import { ccIconUrl, ccName } from '@/lib/util';
import { invincibleOf } from '@/lib/activeDps';
import { bossInfoOf } from '@/lib/bossInfo';
import { hpCrossings, hpCurve, hpPctAt } from '@/lib/hpRuler';
import { ccSeenIn } from '@/lib/skillCcCoverage';
import { untrackedSeen } from '@/lib/skillCcCandidates';
import { BARDSONG_CC_ID } from '@/lib/bardsongTrack';
import {
    buildSelfHistory, castTicks, coverageRows, fightOwner, fightSpan, laneIds, laneSeries,
    runStartTicks,
    type CoverageRow, type DpsEntity,
} from '@/lib/effectTimeline';
import { readTokens } from '../../theme/readTokens';
import { chartView } from './chartView';
import EChart, { type ZoomRange } from '../../charts/EChart.vue';
import {
    dpsTimelineHeight, dpsTimelineOption, ICON_LEFT, INVINCIBLE_NAME, ICON_W, laneIconTops, MAX_POINTS, PARTY_NAME, PLUS_H, PLUS_LEFT, PLUS_W,
    plusTops, TIMELINE_TOKENS,
} from '../../charts/dpsTimelineOption';
import { useContextMenu } from '../../ui/useContextMenu';
import { ccDropKey, ccGroupOf, ccIconDnd, ccMenuItems, type CcGroupKind } from './ccGroupActions';
import {
    chartHiddenCCIds, selfChartHiddenCCIds, selfTrackedCCIds, setChartHiddenCCIds, setSelfChartHiddenCCIds,
    setSelfTrackedCCIds, setTrackedCCIds, trackedCCIds,
} from './ccSettings';
import CcIconGrid from './CcIconGrid.vue';
import CoverageStrip from './CoverageStrip.vue';
import BreakDefenseBox from './BreakDefenseBox.vue';
import CcTip from './CcTip.vue';
import DTooltip from '../../ui/DTooltip.vue';
import DIconButton from '../../ui/DIconButton.vue';

// Collapsing hides the plot and lanes but keeps the coverage strip; kept for this session.
const collapsed = chartView.collapsed;

// Legend toggles must survive rebuilds (setOption resets them). Only the party
// line and the invincible tint are kept; player toggles reset per rebuild.
function onLegend(sel: Record<string, boolean>) {
    chartView.legend = { [PARTY_NAME]: sel[PARTY_NAME] === true, [INVINCIBLE_NAME]: sel[INVINCIBLE_NAME] !== false };
    build();
}
function toggleCollapsed() {
    collapsed.value = !collapsed.value;
    openPlus.value = null;
}

const props = defineProps<{
    // Damage per player, not narrowed by the zoom range (zoom is a view over the whole fight).
    entities: DpsEntity[];
    target: EntityActor | null;
    partyActors: EntityActor[];
}>();

const WINDOW_SEC = 15;
const UPDATE_INTERVAL_MS = 250;

const chart = ref<{ resetZoom(): void; snapshot(width: number): string | null }>();
defineExpose({ snapshot: (width: number) => chart.value?.snapshot(width) ?? null });
const option = shallowRef<Record<string, unknown>>({});
type Values = Map<number, CcValueSummary>;
const groups = shallowRef<{ key?: 'boss' | 'self'; label: string; accent?: boolean; rows: CoverageRow[]; values: Values }[]>([]);
// Each CC's highest readings in the selected range, per group: the CC tooltips and 破防保最高.
const values = shallowRef<{ boss: Values; self: Values }>({ boss: new Map(), self: new Map() });
const laneCount = ref(0);
const selfCount = ref(0);
const rebuildKey = ref('');
// CC of each timeline lane in drawing order, for the icon hit boxes.
const laneCcs = shallowRef<{ group: CcGroupKind; id: number }[]>([]);
// CCs seen in the fight per group (canonical ids); null = the group is not shown.
const seenBoss = shallowRef<Set<number> | null>(null);
const seenSelf = shallowRef<Set<number> | null>(null);
// Absolute second that x = 0 maps to; the zoom event converts back with it.
let origin = 0;
// What the coverage strip needs, kept so a range change recomputes it without rebuilding the chart.
let coverageInput: { boss: EntityConditionState[]; self: EntityConditionState[] | null; start: number; end: number } | null = null;

// Coverage over the selected time range when there is one, else the whole fight.
function buildCoverage() {
    const c = coverageInput;
    if (!c) { groups.value = []; values.value = { boss: new Map(), self: new Map() }; return; }
    const start = Math.max(c.start, timeRangeMin.value ?? c.start);
    const end = Math.min(c.end, timeRangeMax.value ?? c.end);
    const rows = (tracked: number[], chartHidden: Set<number>, history: EntityConditionState[]) =>
        end > start ? coverageRows({ tracked, chartHidden, history, start, end }) : [];
    const v = { boss: ccValueSummaries(c.boss, start, end), self: c.self ? ccValueSummaries(c.self, start, end) : new Map() };
    values.value = v;
    groups.value = [
        { key: 'boss' as const, label: 'BOSS', rows: rows(trackedCCIds.value, chartHiddenCCIds.value, c.boss), values: v.boss },
        { key: 'self' as const, label: '自身', rows: c.self ? rows(selfTrackedCCIds.value, selfChartHiddenCCIds.value, c.self) : [], accent: true, values: v.self },
    ].filter(g => g.rows.length > 0);
}

function build() {
    const span = fightSpan(props.entities);
    if (!span) {
        option.value = {}; groups.value = []; values.value = { boss: new Map(), self: new Map() }; coverageInput = null; laneCount.value = 0; selfCount.value = 0; rebuildKey.value = ''; laneCcs.value = [];
        seenBoss.value = null; seenSelf.value = null;
        return;
    }
    origin = span.start;
    const maxMs = (span.end - span.start) * 1000;
    const am = actorManager.value;
    // BOSS lanes read the target only; 覺醒/戰吼 are 自身 buffs.
    const merged = props.target?.conditionHistory ?? [];
    // Scoped to the fight; clipping seeds the start with the state already active.
    const history = clipToWindow(merged, span.start, span.end);
    const tracked = trackedCCIds.value;
    const ids = laneIds(tracked, chartHiddenCCIds.value, history);

    // The local player at the fight start; no self section when unknown.
    const owner = fightOwner(am.ownerHistory, span.start);
    const selfActor = owner ? am.entityMap[owner] : undefined;
    const selfFull = buildSelfHistory({
        self: selfActor, bardsongEvents: am.bardsongEvents, bardsongPulses: am.bardsongPulses, owners: am.ownerHistory,
    });
    const selfHistory = selfActor ? clipToWindow(selfFull, span.start, span.end) : [];
    const selfIds = selfActor ? laneIds(selfTrackedCCIds.value, selfChartHiddenCCIds.value, selfHistory) : [];
    coverageInput = { boss: merged, self: selfActor ? selfFull : null, start: span.start, end: span.end };
    buildCoverage();

    // Window centred on each point (lib/dpsSeries); stride keeps every line within MAX_POINTS.
    const stride = Math.max(1, Math.ceil(maxMs / 1000 / MAX_POINTS));
    const colorOrder = [...tracked, ...selfTrackedCCIds.value];
    const colorIndex = (id: number) => colorOrder.indexOf(id);
    const lanes = ids.map(id => ({
        ccId: id,
        name: ccName(condNameMap.value, id),
        icon: ccIconUrl(region.value, id),
        points: laneSeries(history, id, span.start, span.end),
        colorIndex: colorIndex(id),
        ticks: showCastTicks.value ? castTicks(props.target?.casts ?? [], id, span.start, span.start, span.end) : [],
    })).filter(l => l.points.length > 0);
    const selfLanes = selfActor ? selfIds.map(id => ({
        ccId: id,
        name: ccName(condNameMap.value, id),
        icon: ccIconUrl(region.value, id),
        points: laneSeries(selfHistory, id, span.start, span.end),
        colorIndex: colorIndex(id),
        ticks: !showCastTicks.value ? []
            : id === BARDSONG_CC_ID
                ? runStartTicks(selfHistory, id, span.start, span.start, span.end)
                : castTicks(selfActor.casts, id, span.start, span.start, span.end),
    })).filter(l => l.points.length > 0) : [];
    seenBoss.value = props.target ? ccSeenIn(merged, span.start, span.end) : null;
    seenSelf.value = selfActor ? ccSeenIn(selfFull, span.start, span.end) : null;
    laneCount.value = lanes.length;
    selfCount.value = selfLanes.length;
    laneCcs.value = [
        ...lanes.map(l => ({ group: 'boss' as const, id: l.ccId })),
        ...selfLanes.map(l => ({ group: 'self' as const, id: l.ccId })),
    ];
    rebuildKey.value = props.entities.map(e => e.name).join(',') + '|' + lanes.map(l => l.ccId).join(',')
        + '|' + selfLanes.map(l => l.ccId).join(',') + '|' + hpGuideStep.value
        + '|' + [showCastTicks.value, showHpRuler.value, showInvincible.value].join(',');
    const invincible = (showInvincible.value ? invincibleOf(props.target?.conditionHistory, span.end) : [])
        .map(([a, b]) => [(a - span.start) * 1000, (b - span.start) * 1000] as [number, number]);
    // Only for a boss with HP data, i.e. when the boss info bar is shown.
    const t = props.target;
    const hasHp = bossInfoOf({
        target: t, isBoss: isBossRace, name: '', dealt: 0, at: null, stats: { fightSec: null, partyDps: 0 },
    }) !== null;
    const curve = hasHp ? hpCurve({
        lifeHistory: t?.lifeHistory ?? [], damages: props.entities.flatMap(e => e.damages),
        maxLife: t?.maxLife ?? 0, start: span.start, end: span.end, downAt: t?.downAt,
    }) : [];
    const marks = hpCrossings(curve);
    option.value = dpsTimelineOption({
        ruler: marks.length ? { marks, originSec: span.start, guideStep: hpGuideStep.value, band: showHpRuler.value } : undefined,
        hpAt: curve.length ? ms => hpPctAt(curve, span.start + ms / 1000) : undefined,
        partyPoints: rollingDamageSeries(props.entities.flatMap(e => e.damages), span.start, WINDOW_SEC, stride),
        entities: props.entities.map(e => ({
            name: e.name, points: rollingDamageSeries(e.damages, span.start, WINDOW_SEC, stride),
        })),
        legendSelected: chartView.legend, lanes, selfLanes, invincible, maxMs, tokens: readTokens(TIMELINE_TOKENS),
        selfTitle: '自身', reserveSelfRow: seenSelf.value !== null,
    });
}

function selfCastsLen(): number {
    const am = actorManager.value;
    const start = fightSpan(props.entities)?.start;
    return start === undefined ? 0 : am.entityMap[fightOwner(am.ownerHistory, start)]?.casts.length ?? 0;
}

// Throttled to 250 ms; the first build is immediate. A layout change (names or
// lanes) shows up in rebuildKey, which makes EChart rebuild with notMerge.
let timer = 0;
function schedule() {
    if (timer) return;
    if (Object.keys(option.value).length === 0) { build(); return; }
    timer = window.setTimeout(() => { timer = 0; build(); }, UPDATE_INTERVAL_MS);
}
watch(
    [() => props.entities, () => props.target, () => props.partyActors,
        () => actorManager.value.bardsongEvents.length, () => actorManager.value.bardsongPulses.length,
        () => actorManager.value.ownerHistory.length,
        () => props.target?.casts.length, () => selfCastsLen(),
        () => props.target?.lifeHistory.length, () => props.target?.conditionHistory.length, () => props.target?.downAt,
        () => props.partyActors.reduce((n, a) => n + a.casts.length, 0),
        trackedCCIds, chartHiddenCCIds, selfTrackedCCIds, selfChartHiddenCCIds, condNameMap, hpGuideStep,
        showCastTicks, showHpRuler, showInvincible],
    schedule, { immediate: true },
);
onBeforeUnmount(() => { if (timer) clearTimeout(timer); });

function onZoom(r: ZoomRange | null) {
    if (r === null) clearTimeRange();
    else setTimeRange(origin + r.startMs / 1000, origin + r.endMs / 1000);
}

// A range cleared elsewhere (e.g. the filter bar) resets the chart view; EChart does not echo it back.
watch([timeRangeMin, timeRangeMax], ([lo, hi]) => {
    if (lo === null && hi === null) chart.value?.resetZoom();
    buildCoverage();
});

const height = computed(() => dpsTimelineHeight(laneCount.value, selfCount.value, seenSelf.value !== null));
const tops = computed(() => plusTops(laneCount.value, selfCount.value));
const laneHits = computed(() => {
    const t = laneIconTops(laneCount.value, selfCount.value);
    return laneCcs.value.map((l, k) => ({ ...l, top: t[k], key: `${l.group}:${l.id}` }));
});
const menu = useContextMenu();
const onLaneMenu = (group: CcGroupKind, id: number, e: MouseEvent) => menu.open(e, ccMenuItems(ccGroupOf(group), id));

// ＋ popover: seen-but-untracked CCs of one group.
const uid = Symbol('dpsTimeline');
const plusFor = computed(() => (openPlus.value?.owner === uid ? openPlus.value.group : null));
const candidates = computed(() => {
    const pick = (seen: Set<number> | null, tracked: number[]) => seen ? untrackedSeen(seen, tracked) : [];
    return plusFor.value === 'self'
        ? pick(seenSelf.value, selfTrackedCCIds.value) : pick(seenBoss.value, trackedCCIds.value);
});
const TITLES = { boss: 'BOSS 身上出現過', self: '自身出現過' } as const;
const HELP = [
    'Ctrl＋滾輪：縮放時間　拖曳圖表：平移',
    '右上角：框選縮放／還原縮放；縮放後下方數字只算該區段',
    '右鍵狀態列或覆蓋率圖示：時間軸與覆蓋率／僅覆蓋率／移除',
    '拖曳狀態列或覆蓋率圖示：調整順序',
    '＋：加入這場出現過的 CC',
    '點玩家列下方的色條：開全部命中',
].join('\n');

// Fixed to the viewport (teleported), so the chart's clipping never hides it.
const GAP = 2;
const EDGE = 4;
const anchor = ref<HTMLElement | null>(null);
const pop = ref<HTMLElement | null>(null);
const pos = ref({ left: 0, top: 0 });
async function place() {
    await nextTick();
    if (!anchor.value || !pop.value) return;
    const a = anchor.value.getBoundingClientRect();
    const p = pop.value.getBoundingClientRect();
    let top = a.bottom + GAP;
    if (top + p.height > window.innerHeight - EDGE) top = Math.max(EDGE, a.top - p.height - GAP);
    pos.value = { left: Math.max(EDGE, Math.min(a.left, window.innerWidth - p.width - EDGE)), top };
}
// Scroll events a click causes (focus scrolling) arrive before the next frame's callbacks.
let armed = false;
let armFrame = 0;
function togglePlus(e: MouseEvent, group: 'boss' | 'self', strip = false) {
    if (plusFor.value === group && openPlus.value?.strip === strip) { openPlus.value = null; return; }
    anchor.value = e.currentTarget as HTMLElement;
    openPlus.value = { owner: uid, group, strip };
    armed = false;
    cancelAnimationFrame(armFrame);
    armFrame = requestAnimationFrame(() => { armed = true; });
    place();
}
function onPointerDown(e: Event) {
    if (plusFor.value === null) return;
    const t = e.target as Element | null;
    if (t && (pop.value?.contains(t) || t.closest?.('.plus-btn, .strip-plus'))) return;
    openPlus.value = null;
}
// Capture phase so Esc closes the popover before a dialog underneath sees it.
function onKey(e: KeyboardEvent) {
    if (plusFor.value !== null && e.key === 'Escape') {
        e.stopPropagation();
        openPlus.value = null;
    }
}
// The popover is fixed to the viewport, so any scroll or resize would strand it.
function closePlus() { openPlus.value = null; }
function onScroll(e: Event) {
    if (plusFor.value === null || !armed) return;
    if (e.target instanceof Node && pop.value?.contains(e.target)) return;
    openPlus.value = null;
}
onMounted(() => {
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', closePlus);
});
onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('scroll', onScroll, true);
    cancelAnimationFrame(armFrame);
    window.removeEventListener('resize', closePlus);
    if (openPlus.value?.owner === uid) openPlus.value = null;
});
function addCc(group: 'boss' | 'self', id: number) {
    // From the strip: coverage-only, so hide the lane. From the chart: un-hide it (else no lane appears).
    const stripPick = openPlus.value?.strip === true;
    if (group === 'self') {
        setSelfTrackedCCIds([...selfTrackedCCIds.value, id]);
        if (stripPick) setSelfChartHiddenCCIds(new Set([...selfChartHiddenCCIds.value, id]));
        else if (selfChartHiddenCCIds.value.has(id)) setSelfChartHiddenCCIds(new Set([...selfChartHiddenCCIds.value].filter(x => x !== id)));
    } else {
        setTrackedCCIds([...trackedCCIds.value, id]);
        if (stripPick) setChartHiddenCCIds(new Set([...chartHiddenCCIds.value, id]));
        else if (chartHiddenCCIds.value.has(id)) setChartHiddenCCIds(new Set([...chartHiddenCCIds.value].filter(x => x !== id)));
    }
    openPlus.value = null;
}
</script>

<template>
  <div v-if="entities.length > 0" class="dps-timeline" :class="{ collapsed }">
    <slot name="header" />
    <div class="body">
      <DIconButton
        class="collapse"
        data-collapse
        data-html2canvas-ignore
        :icon="collapsed ? 'mdi-chevron-right' : 'mdi-chevron-down'"
        :title="collapsed ? '展開圖表' : '收合圖表'"
        @click="toggleCollapsed"
      />
      <i
        v-if="!collapsed"
        class="mdi mdi-help-circle-outline help"
        data-chart-help
        data-html2canvas-ignore
        :title="HELP"
      />
      <div v-if="collapsed" class="collapsed-title">DPS 與狀態時間軸（已收合）</div>
      <EChart v-else ref="chart" :option="option" :rebuild-key="rebuildKey" :height="height" @zoom="onZoom" @legend="onLegend" />
      <template v-if="!collapsed">
        <DTooltip
          v-for="l in laneHits"
          :key="l.key"
          bare
          placement="right"
          class="lane-hit"
          :class="{ drop: ccDropKey === l.key }"
          data-html2canvas-ignore
          :data-lane-cc="l.id"
          :data-lane-group="l.group"
          draggable="true"
          :style="{ top: `${l.top}px`, left: `${ICON_LEFT}px`, width: `${ICON_W}px`, height: `${ICON_W}px` }"
          @contextmenu="onLaneMenu(l.group, l.id, $event)"
          v-on="ccIconDnd(l.group, l.id, false)"
        >
          <template #content><CcTip :cc-id="l.id" :summary="values[l.group].get(l.id)" hint="右鍵選單，拖曳排序" /></template>
        </DTooltip>
        <template v-for="g in (['boss', 'self'] as const)" :key="g">
          <button
            v-if="(g === 'boss' ? seenBoss : seenSelf) !== null"
            type="button"
            class="plus-btn"
            data-html2canvas-ignore
            :data-plus="g"
            :title="g === 'boss' ? '加入 BOSS 追蹤 CC' : '加入自身追蹤 CC'"
            aria-haspopup="true"
            :aria-expanded="plusFor === g && !openPlus?.strip"
            :style="{ top: `${tops[g]}px`, left: `${PLUS_LEFT}px`, width: `${PLUS_W}px`, height: `${PLUS_H}px` }"
            @click.stop="togglePlus($event, g)"
          >＋</button>
        </template>
      </template>
    <Teleport to="body">
      <div
        v-if="plusFor !== null"
        :ref="(el: unknown) => (pop = el as HTMLElement | null)"
        class="cc-pop"
        data-html2canvas-ignore
        :style="{ position: 'fixed', left: `${pos.left}px`, top: `${pos.top}px` }"
        @click.stop
      >
        <div class="pop-title">{{ TITLES[plusFor] }}{{ openPlus?.strip ? '（僅覆蓋率）' : '' }}</div>
        <CcIconGrid :ids="candidates" empty-text="沒有可加入的 CC" @pick="id => addCc(plusFor!, id)" />
      </div>
    </Teleport>
      <CoverageStrip :groups="groups" :open-group="openPlus?.owner === uid && openPlus.strip ? openPlus.group : null" @plus="(g, e) => togglePlus(e, g, true)">
        <template v-if="target" #side><BreakDefenseBox :values="values.boss" /></template>
      </CoverageStrip>
    </div>
  </div>
</template>

<style scoped>
.dps-timeline {
  margin-bottom: 0;
  border: 1px solid var(--c-line);
  border-radius: var(--radius);
  background: var(--c-surface);
  overflow: hidden;
}
/* The body is the chevron's anchor, so a header slot above never sits under it. */
.body { position: relative; }
/* Leading chevron like a player row; the collapsed title sits where the chart title does (LEFT 50 + 5 padding). */
.collapse { position: absolute; top: 0; left: 8px; z-index: 1; }
.collapsed-title { padding: var(--space-2) var(--space-4) var(--space-2) 55px; color: var(--c-text-dim); font-size: var(--fs-sm); }
/* Over the chart canvas, left of the group labels; positions come from plusTops(). */
.plus-btn {
  position: absolute; z-index: 1; padding: 0; line-height: 1; font-size: var(--fs-xs);
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px dashed var(--c-line); border-radius: var(--radius);
  background: var(--c-surface); color: var(--c-text-dim); cursor: pointer;
}
.plus-btn:hover { color: var(--c-accent); border-color: var(--c-accent); }
/* Left of the ECharts toolbox (two 12px icons at the top right). */
.help { position: absolute; top: 15px; right: 72px; z-index: 1; color: var(--c-text-dim); font-size: 14px; cursor: help; }
.help:hover { color: var(--c-text); }
/* Transparent boxes over the ECharts-drawn lane icons. */
/* pointer, not grab: Chromium draws grab as an oversized bitmap on scaled Windows displays. */
.lane-hit { position: absolute; z-index: 1; border-radius: 2px; cursor: pointer; }
.lane-hit:hover { outline: 1px solid var(--c-accent); }
.lane-hit.drop { outline: 2px solid var(--c-accent); }
.cc-pop {
  z-index: 2500;
  display: flex; flex-direction: column; gap: var(--space-2);
  width: max-content; max-width: 280px; padding: var(--space-3);
  border: 1px solid var(--c-line); border-radius: var(--radius);
  background: var(--c-bg); box-shadow: 0 4px 12px rgb(0 0 0 / 30%);
}
.pop-title { font-size: var(--fs-xs); color: var(--c-text-dim); }
</style>

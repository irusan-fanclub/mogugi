<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
    actorManager, dcManager, appEvent, raceNameMap, skillNameMap,
    timeRangeMin, timeRangeMax, hiddenSkillColumns, skillColumnOrder, skillRowLimit,
    showPetSkills, autoSelectBoss, bossOnlyTarget, setBossOnlyTarget, isBossRace, hiddenTargetRaces, setHiddenTargetRaces,
} from '@/store';
import type { DamageCollectorBase, DualGroupedDamageCollector, GroupedDamageCollector } from '@/actionCollector';
import { ActorManager, type EntityActor, type EntityConditionState, type EntityDamage } from '@/eventActor';
import { bossInfoOf } from '@/lib/bossInfo';
import { fightStats } from '@/lib/overlayModel';
import { buildPlayerRows, dpsOf, shareOf } from '@/lib/battleStats';
import { buildDpsEntities, fightOwner, fightSpan, playerSelfHistory } from '@/lib/effectTimeline';
import { activeDps, activeSeconds, deathSpans, excludedSpans, invincibleOf, type Span } from '@/lib/activeDps';
import { DETAIL_COLUMNS, mergeColumnOrder, visibleColumns } from '@/lib/skillColumns';
import type { SkillRow } from '@/lib/skillRows';
import {
    buildTargetList, hideTarget as hideTargetIn, pickNewBoss, targetLabel, targetShortLabel,
} from '@/lib/targets';
import { computeGroupedStats, filterByTimeRange } from '@/lib/timeRangeFilter';
import { deriveMusicBuffCell, type MusicBuffCell } from '@/lib/musicBuff';
import { ARCANA_BY_SKILL } from '@/lib/arcanaTable';
import { ccSeenIn } from '@/lib/skillCcCoverage';
import { buildSkillCcSeen, EMPTY_SKILL_CC_SEEN } from '@/lib/skillCcSeen';
import { aliasOf, clearAlias, clearAllAliases, hasAnyAlias, randomAlias, randomizeAll } from '@/lib/entityAlias';
import { formatMinSec, prettyEntityName, stripRaceSuffix } from '@/lib/util';
import type { ChartSpec } from '@/lib/chartProtocol';
import { useSession } from '../../session';
import { useToast } from '../../ui/useToast';
import { useContextMenu } from '../../ui/useContextMenu';
import { openChart } from '../../windows/openChart';
import BattleToolbar from './BattleToolbar.vue';
import PlayerRow from './PlayerRow.vue';
import PlayerListHeader from './PlayerListHeader.vue';
import SkillTable from './SkillTable.vue';
import DpsTimeline from './DpsTimeline.vue';
import { SERIES_COUNT } from '../../charts/dpsTimelineOption';
import BossInfoBar from './BossInfoBar.vue';
import BattleSettings from './BattleSettings.vue';
import DButton from '../../ui/DButton.vue';
import DDialog from '../../ui/DDialog.vue';
import TimeFilterBar from './TimeFilterBar.vue';
import CcResetPrompt from './CcResetPrompt.vue';
import { captureBattle, SHOT_TEXT, SHOT_WIDTH, shotContextText } from './screenshot';
import type { PlayerVM } from './battleTypes';
import { selectedTargetId } from './battleSelection';

const session = useSession();
const toast = useToast();
const ctx = useContextMenu();

// Below this container width every music cell goes icon-only together.
const NARROW_PX = 720;
const EXPANDED_MAX = 50;

const root = ref<HTMLElement>();
const narrow = ref(false);
// Where the rows put the music cell, so the header's 音樂 label sits over it.
const musicLeft = ref<number | null>(null);
function measureMusic() {
    const row = listEl.value?.querySelector<HTMLElement>('.player-row');
    const cell = row?.querySelector<HTMLElement>('.music');
    musicLeft.value = row && cell ? Math.round(cell.getBoundingClientRect().left - row.getBoundingClientRect().left) : null;
}
let ro: ResizeObserver | undefined;

// --- collectors (one per player, created lazily, released on unmount) ---
const collectors: Record<string, DamageCollectorBase> = {};
function dcOf(attackerId: string): DualGroupedDamageCollector {
    return (collectors[attackerId] ??= dcManager.value.getDualGroupedDamageCollector(
        v => v.Id == attackerId, v => v.TargetId, v => `${v.SkillId}`)) as DualGroupedDamageCollector;
}
function targetCollector(): GroupedDamageCollector {
    return (collectors['target'] ??= dcManager.value.getGroupedDamageCollector(() => true, v => v.TargetId)) as GroupedDamageCollector;
}
const targetDC = targetCollector();

// --- targets ---
const targetId = selectedTargetId;
targetId.value = ''; // a fresh tab starts unselected, as before the state was shared
// Ids of targets with no known race; races are hidden through the persisted list.
const hiddenTargets = ref(new Set<string>());
const actorOf = (id: string): EntityActor | undefined => actorManager.value.entityMap[id];
const raceOfTarget = (id: string) => actorOf(id)?.raceId ?? -1;
const prettyName = (a?: EntityActor) => prettyEntityName(a, raceNameMap);

const targetList = computed(() => {
    const minAt = timeRangeMin.value;
    const maxAt = timeRangeMax.value;
    const common = {
        hiddenIds: hiddenTargets.value,
        hiddenRaces: hiddenTargetRaces.value,
        bossOnly: bossOnlyTarget.value,
        raceOf: raceOfTarget,
        isBoss: isBossRace,
        isAlly: ActorManager.isAllyId,
    };
    if (minAt !== null && maxAt !== null) {
        const stats = computeGroupedStats(filterByTimeRange(targetDC.damages, minAt, maxAt), d => d.TargetId);
        return buildTargetList({ ...common, totals: stats.groupedTotalDamages, total: stats.totalDamage });
    }
    return buildTargetList({ ...common, totals: targetDC.groupedTotalDamages, total: targetDC.totalDamage });
});
const labelOpts = {
    isBossRace,
    raceName: (race: number) => raceNameMap.value[race],
    prettyName,
};
const targetItems = computed(() => targetList.value.map(targetItem));
function targetItem(entry: [string, number]) {
    const actor = actorOf(entry[0]);
    return {
        value: entry[0],
        title: targetLabel(entry, actor, { ...labelOpts, finisherFallback: !actorManager.value.hasFinishFlags }),
        short: entry[0] && actor ? targetShortLabel(actor, labelOpts) : undefined,
        boss: !!actor && isBossRace(actor.raceId),
    };
}
const hiddenCount = computed(() => hiddenTargets.value.size + hiddenTargetRaces.value.size);

function hideTarget(id: string) {
    const state = { ids: new Set(hiddenTargets.value), races: new Set(hiddenTargetRaces.value) };
    hideTargetIn(state, id, raceOfTarget);
    hiddenTargets.value = state.ids;
    setHiddenTargetRaces(state.races);
    const t = targetId.value;
    if (t && (state.ids.has(t) || state.races.has(raceOfTarget(t)))) targetId.value = '';
}
function restoreTargets() {
    hiddenTargets.value = new Set();
    setHiddenTargetRaces(new Set());
}

// An evicted target leaves entityMap; fall back to the unselected default.
watch(() => targetId.value && actorManager.value.entityMap[targetId.value], found => {
    if (targetId.value && !found) targetId.value = '';
});

// Auto-select only when a never-seen boss appears; the watch tracks keys only.
const seenBossIds = new Set<string>();
watch(() => Object.keys(actorManager.value.entityMap), keys => {
    if (!autoSelectBoss.value) return;
    const picked = pickNewBoss(keys, seenBossIds, id => {
        const a = actorManager.value.entityMap[id];
        return !!a && isBossRace(a.raceId);
    });
    if (picked !== null) targetId.value = picked;
}, { immediate: true });

// --- player rows ---
const hiddenArcana = ref(new Set<string>());

function arcanaOf(actor: EntityActor): number | null {
    // Last recognised arcana skill wins, scanned from the end without copying.
    const hits = actor.applyDamages;
    for (let i = hits.length - 1; i >= 0; i--) {
        const a = ARCANA_BY_SKILL[hits[i].SkillId];
        if (a !== undefined) return a;
    }
    return null;
}

const players = computed((): PlayerVM[] => {
    const minAt = timeRangeMin.value;
    const maxAt = timeRangeMax.value;
    const tid = targetId.value;
    const actors = Object.values(actorManager.value.entityMap).filter(a => a.isPC);
    const rows = buildPlayerRows({
        actors,
        byAttacker: id => dcOf(id).damages,
        targetId: tid,
        minAt,
        maxAt,
        // Without a time filter the collectors already hold the totals.
        preaggregated: minAt !== null && maxAt !== null ? undefined : id => {
            const dc = dcOf(id);
            return tid
                ? { damages: dc.groupedDamages[tid] ?? [], total: dc.groupedTotalDamages[tid] ?? 0 }
                : { damages: dc.damages, total: dc.totalDamage };
        },
    });
    const all = rows.reduce((s, r) => s + r.totalDamage, 0);
    // Whole-fight exclusions, not range-narrowed; deaths are per player.
    const span = fightSpan(chartEntities.value);
    const invincible = span ? invincibleOf(chartTarget.value?.conditionHistory, span.end) : [];
    return rows.map(r => {
        const d = r.damages;
        const excluded: Span[] = span
            ? excludedSpans(span.start, [...invincible, ...deathSpans(r.actor.deathHistory, span.end)])
            : [];
        const music: MusicBuffCell = d.length === 0
            ? { kind: 'absent' }
            : deriveMusicBuffCell(r.actor.conditionHistory, d[0].At, d[d.length - 1].At);
        const windows: Span[] = d.length >= 2 ? [[d[0].At, d[d.length - 1].At]] : [];
        const activeSec = activeSeconds(windows, excluded);
        return {
            id: r.actor.id,
            realName: r.actor.name,
            name: prettyName(r.actor) ?? r.actor.name,
            arcana: arcanaOf(r.actor),
            arcanaHidden: hiddenArcana.value.has(r.actor.id),
            total: r.totalDamage,
            spanSec: d.length >= 2 ? d[d.length - 1].At - d[0].At : 0,
            dps: dpsOf(r.totalDamage, d),
            activeDps: activeDps(d, windows, excluded),
            activeSec: activeSec > 0 ? activeSec : null,
            excluded,
            share: shareOf(r.totalDamage, all),
            music,
            hasCondition: r.actor.conditionHistory.length > 0,
            damages: d,
            skillUses: r.actor.skillUses,
        };
    });
});
// Chart input: every PC's hits on the selected target. Not narrowed by the time
// range, because zooming the chart is what sets that range.
const chartEntities = computed(() => {
    const grouped: Record<string, EntityDamage[]> = {};
    for (const a of Object.values(actorManager.value.entityMap)) {
        if (a.isPC) grouped[a.id] = dcOf(a.id).damages;
    }
    return buildDpsEntities({
        grouped, actorOf, nameOf: (a, id) => prettyName(a as EntityActor) ?? id,
        targetId: targetId.value, minAt: null, maxAt: null,
    });
});
// Same order and palette as the chart's lines (dpsTimelineOption colours entity i with series i).
const seriesColorById = computed(() => new Map(chartEntities.value.map((e, i) =>
    [e.id, `var(--c-series-${(i % SERIES_COUNT) + 1})`])));
const chartTarget = computed(() => (targetId.value ? actorOf(targetId.value) ?? null : null));
// Local player at the fight start (the owner can change between fights).
const ownerId = computed(() => {
    const am = actorManager.value;
    const start = fightSpan(chartEntities.value)?.start;
    return start === undefined ? am.ownerEntityId : fightOwner(am.ownerHistory, start);
});
const selfActor = computed((): EntityActor | null => actorManager.value.entityMap[ownerId.value] ?? null);
// 自身 history per player, built lazily; an entry is rebuilt when its source arrays grow,
// since the memo outlives the in-place appends that re-run the callers.
const selfHistoryById = computed(() => {
    const am = actorManager.value;
    const owner = ownerId.value;
    const cache = new Map<string, { sig: number[]; h: EntityConditionState[] }>();
    return (pid: string): EntityConditionState[] => {
        const a = actorOf(pid);
        const sig = [a?.conditionHistory.length ?? -1, am.bardsongEvents.length, am.bardsongPulses.length, am.ownerHistory.length];
        let e = cache.get(pid);
        if (!e || e.sig.some((n, i) => n !== sig[i])) {
            e = {
                sig, h: playerSelfHistory(a, pid === owner, {
                    bardsongEvents: am.bardsongEvents, bardsongPulses: am.bardsongPulses, owners: am.ownerHistory,
                }),
            };
            cache.set(pid, e);
        }
        return e.h;
    };
});
// Only built while the settings dialog is open.
const settingsSelfHistory = computed(() => settingsOpen.value && selfActor.value
    ? selfHistoryById.value(ownerId.value) : undefined);
const ccSeen = computed(() => settingsOpen.value
    ? buildSkillCcSeen(Object.values(actorManager.value.entityMap), arcanaOf)
    : EMPTY_SKILL_CC_SEEN);
const partyActors = computed(() => Object.values(actorManager.value.entityMap).filter(a => a.isPC));
// Boss bar: hits on the selected target, at the same range end as the player list.
const bossInfo = computed(() => {
    const t = chartTarget.value;
    const dealt = targetList.value.find(([id]) => id === targetId.value)?.[1] ?? t?.totalTakeDamage ?? 0;
    return bossInfoOf({
        target: t, isBoss: isBossRace, name: t ? stripRaceSuffix(t.raceId, raceNameMap.value[t.raceId]) : '', dealt, at: timeRangeMax.value,
        stats: fightStats(players.value.map(p => ({ damages: p.damages, totalDamage: p.total }))),
    });
});
const realNames = computed(() => players.value.map(p => p.realName));
// The whole fight's first hit, ignoring the time filter: the chart's x = 0, so every m:ss on the tab shares it.
const fightStartAt = computed(() => fightSpan(chartEntities.value)?.start ?? 0);
const allArcanaHidden = computed(() =>
    players.value.length > 0 && players.value.every(p => p.arcanaHidden));

function toggleArcana(id: string) {
    const next = new Set(hiddenArcana.value);
    if (next.has(id)) next.delete(id); else next.add(id);
    hiddenArcana.value = next;
}
function toggleAllArcana() {
    hiddenArcana.value = allArcanaHidden.value ? new Set() : new Set(players.value.map(p => p.id));
}

// --- expansion, by real name, for this session ---
const expanded = ref<string[]>([]);
const isOpen = (name: string) => expanded.value.includes(name);
function toggleOpen(name: string) {
    const next = isOpen(name) ? expanded.value.filter(n => n !== name) : [...expanded.value, name];
    expanded.value = next.slice(-EXPANDED_MAX);
}
// --- 精簡／詳細, by real name like the expansion ---
const detailed = ref<string[]>([]);
const isDetailed = (name: string) => detailed.value.includes(name);
function setDetailed(name: string, on: boolean) {
    const rest = detailed.value.filter(n => n !== name);
    detailed.value = (on ? [...rest, name] : rest).slice(-EXPANDED_MAX);
}
const NO_SEEN = { boss: new Set<number>(), self: new Set<number>() };
// Span = the player's first to last hit, as the music cell uses; only detailed players pay.
const seenById = computed(() => {
    const out: Record<string, { boss: Set<number>; self: Set<number> }> = {};
    for (const p of players.value) {
        if (!isOpen(p.realName) || !isDetailed(p.realName) || p.damages.length === 0) continue;
        const from = p.damages[0].At, to = p.damages[p.damages.length - 1].At;
        const boss = new Set<number>();
        for (const t of new Set(p.damages.map(d => d.TargetId))) {
            for (const id of ccSeenIn(actorOf(t)?.conditionHistory ?? [], from, to)) boss.add(id);
        }
        out[p.id] = { boss, self: ccSeenIn(selfHistoryById.value(p.id), from, to) };
    }
    return out;
});
const historyOfById = computed(() => {
    const out: Record<string, (section: 'boss' | 'self', hit: EntityDamage) => EntityConditionState[]> = {};
    for (const p of players.value) {
        out[p.id] = (section, hit) =>
            section === 'boss' ? actorOf(hit.TargetId)?.conditionHistory ?? [] : selfHistoryById.value(p.id);
    }
    return out;
});

// Per-player "show all skills" override of the row limit; not persisted.
const showAllSkills = ref(new Set<string>());
function toggleShowAll(name: string) {
    const next = new Set(showAllSkills.value);
    if (next.has(name)) next.delete(name); else next.add(name);
    showAllSkills.value = next;
}

// --- skill table settings ---
const COLUMN_BY_KEY = new Map(DETAIL_COLUMNS.map(c => [c.key, c]));
const columns = computed(() =>
    visibleColumns(mergeColumnOrder(skillColumnOrder.value), hiddenSkillColumns.value).map(k => COLUMN_BY_KEY.get(k)!));
const skillName = (id: number) => skillNameMap.value[id] || `unknownSkill:${id}`;

// --- chart windows ---
function open(spec: ChartSpec, title: string) {
    openChart(spec, title);
}
function openTimeline(p: PlayerVM) {
    if (p.hasCondition) open({ kind: 'condition', attackerId: p.id }, `CC - ${p.name}`);
}
function openPlayerHits(p: PlayerVM) {
    open({ kind: 'hitlog', attackerId: p.id, targetId: targetId.value }, `${p.name} → All`);
}
function openSkillHits(p: PlayerVM, skillId: number) {
    open({ kind: 'hitlog', attackerId: p.id, targetId: targetId.value, skillId }, `${p.name} → ${skillName(skillId)}`);
}

// --- context menus ---
async function copy(text: string) {
    try {
        await navigator.clipboard.writeText(text);
        toast.show('已複製');
    } catch {
        toast.show('複製失敗');
    }
}
const editingName = ref<string | null>(null);

function playerMenu(e: MouseEvent, p: PlayerVM) {
    ctx.open(e, [
        { label: isOpen(p.realName) ? '收合' : '展開', icon: 'mdi-unfold-more-horizontal', action: () => toggleOpen(p.realName) },
        'divider',
        { label: '開狀態時間軸', icon: 'mdi-chart-timeline', disabled: !p.hasCondition, action: () => openTimeline(p) },
        { label: '開全部命中', icon: 'mdi-format-list-bulleted', action: () => openPlayerHits(p) },
        'divider',
        { label: '複製名稱', icon: 'mdi-content-copy', action: () => copy(p.name) },
        { label: '改別名', icon: 'mdi-pencil', action: () => { editingName.value = p.realName; } },
        { label: '隨機別名', icon: 'mdi-dice-5', action: () => randomAlias(p.realName, realNames.value) },
        { label: '還原名稱', icon: 'mdi-backup-restore', disabled: aliasOf(p.realName) === undefined, action: () => clearAlias(p.realName) },
        { label: p.arcanaHidden ? '顯示秘法' : '隱藏秘法', icon: p.arcanaHidden ? 'mdi-eye' : 'mdi-eye-off', action: () => toggleArcana(p.id) },
    ]);
}
function skillMenu(e: MouseEvent, p: PlayerVM, row: SkillRow) {
    ctx.open(e, [
        { label: '開命中紀錄', icon: 'mdi-format-list-bulleted', action: () => openSkillHits(p, row.skillId) },
        { label: '複製技能名稱', icon: 'mdi-content-copy', action: () => copy(row.name) },
    ]);
}
function targetMenu(e: MouseEvent, id: string) {
    const actor = actorOf(id);
    const name = prettyName(actor) ?? id;
    ctx.open(e, [
        { label: '隱藏此目標', icon: 'mdi-eye-off', action: () => hideTarget(id) },
        { label: '複製名稱', icon: 'mdi-content-copy', action: () => copy(name) },
    ]);
}

// --- settings and screenshot ---
const settingsOpen = ref(false);
const capturing = ref(false);
const chartWrap = ref<HTMLElement>();
const timeline = ref<{ snapshot(width: number): string | null }>();
const listEl = ref<HTMLElement>();
watch([() => players.value.length > 0, narrow], () => nextTick(measureMusic), { flush: 'post', immediate: true });

// Footer line saying what the PNG covers; the filter bar itself is not captured.
const shotContext = computed(() => {
    const t = chartTarget.value;
    const target = t ? targetShortLabel(t, labelOpts) || prettyName(t) || t.id : '全部目標';
    const lo = timeRangeMin.value;
    const hi = timeRangeMax.value;
    const range = lo !== null && hi !== null
        ? `${formatMinSec(lo - fightStartAt.value)} ~ ${formatMinSec(hi - fightStartAt.value)}` : null;
    return shotContextText(target, range);
});
// The clone is laid out at SHOT_WIDTH and the chart swapped for a render at its new width.
async function prepareShot(doc: Document) {
    const cloneRoot = doc.querySelector<HTMLElement>('[data-shot-root]');
    if (!cloneRoot) return;
    cloneRoot.style.width = `${SHOT_WIDTH}px`;
    const host = doc.querySelector<HTMLElement>('[data-shot-chart]');
    const url = host ? timeline.value?.snapshot(host.clientWidth) : null;
    if (!host || !url) return;
    const img = doc.createElement('img');
    img.src = url;
    img.style.cssText = `display:block;width:${host.clientWidth}px;height:${host.clientHeight}px`;
    host.replaceChildren(img);
    await img.decode().catch(() => undefined);
}

async function screenshot() {
    if (capturing.value || !chartWrap.value || !listEl.value) return;
    capturing.value = true;
    try {
        const result = await captureBattle({ chart: chartWrap.value, list: listEl.value }, {
            version: __APP_VERSION__, client: session.source?.value?.ClientVersion, context: shotContext.value,
        }, prepareShot);
        toast.show(SHOT_TEXT[result]);
    } catch (e) {
        console.error('screenshot failed:', e);
        toast.show(SHOT_TEXT.failed);
    } finally {
        capturing.value = false;
    }
}

// --- toolbar actions ---
// Clearing drops a loaded record too, so it asks first.
const confirmClear = ref(false);
function clearAll() {
    confirmClear.value = false;
    session.clearData();
    targetId.value = '';
}
const onClear = () => { targetId.value = ''; };

onMounted(() => {
    appEvent.value.addEventListener('clear', onClear);
    if (root.value && typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(entries => {
            narrow.value = (entries[0]?.contentRect.width ?? 0) < NARROW_PX;
            measureMusic();
        });
        ro.observe(root.value);
    }
});
onBeforeUnmount(() => {
    appEvent.value.removeEventListener('clear', onClear);
    ro?.disconnect();
    for (const c of Object.values(collectors)) dcManager.value.removeDamageCollector(c);
});
</script>

<template>
  <div ref="root" class="battle" data-shot-root>
    <BattleToolbar
      v-model:target="targetId"
      :boss-only="bossOnlyTarget"
      :items="targetItems"
      :hidden-count="hiddenCount"
      :has-alias="hasAnyAlias"
      :arcana-hidden="allArcanaHidden"
      @update:boss-only="setBossOnlyTarget"
      @hide-target="hideTarget"
      @restore-targets="restoreTargets"
      @target-menu="targetMenu"
      @random-names="randomizeAll([...realNames])"
      @restore-names="clearAllAliases()"
      @toggle-arcana="toggleAllArcana"
      @clear="confirmClear = true"
      :capturing="capturing"
      @settings="settingsOpen = true"
      @screenshot="screenshot"
    />
    <TimeFilterBar :origin="fightStartAt" />
    <div ref="chartWrap">
      <DpsTimeline ref="timeline" :entities="chartEntities" :target="chartTarget" :party-actors="partyActors">
        <template v-if="bossInfo" #header><BossInfoBar :info="bossInfo" /></template>
      </DpsTimeline>
    </div>
    <div ref="listEl" class="list">
      <PlayerListHeader v-if="players.length > 0" :narrow="narrow" :music-left="musicLeft" />
      <PlayerRow
        v-for="p in players"
        :key="p.id"
        :vm="p"
        :expanded="isOpen(p.realName)"
        :narrow="narrow"
        :origin="fightStartAt"
        :series-color="seriesColorById.get(p.id)"
        :known-real-names="realNames"
        :editing="editingName === p.realName"
        @update:editing="v => (editingName = v ? p.realName : null)"
        @toggle="toggleOpen(p.realName)"
        @arcana="toggleArcana(p.id)"
        @timeline="openTimeline(p)"
        @hits="openPlayerHits(p)"
        @menu="e => playerMenu(e, p)"
      >
        <SkillTable
          v-if="isOpen(p.realName)"
          :vm="p"
          :columns="columns"
          :limit="skillRowLimit"
          :show-all="showAllSkills.has(p.realName)"
          :show-pet="showPetSkills"
          :min-at="timeRangeMin"
          :max-at="timeRangeMax"
          :skill-name="skillName"
          :detailed="isDetailed(p.realName)"
          :history-of="historyOfById[p.id]"
          :seen="seenById[p.id] ?? NO_SEEN"
          @update:detailed="v => setDetailed(p.realName, v)"
          @hits="id => openSkillHits(p, id)"
          @menu="(e, row) => skillMenu(e, p, row)"
          @toggle-all="toggleShowAll(p.realName)"
        />
      </PlayerRow>
      <div v-if="players.length === 0" class="empty">尚無戰鬥資料</div>
    </div>
    <BattleSettings v-model="settingsOpen" :target="chartTarget" :self="selfActor" :self-history="settingsSelfHistory" :cc-seen="ccSeen" />
    <CcResetPrompt />
    <DDialog v-model="confirmClear" title="清除資料">
      <span data-clear-confirm>清除戰鬥分頁的所有資料（含已載入的紀錄）？已存的戰鬥紀錄檔不受影響。</span>
      <template #actions>
        <DButton @click="confirmClear = false">取消</DButton>
        <DButton variant="danger" data-clear-ok @click="clearAll">清除</DButton>
      </template>
    </DDialog>
  </div>
</template>

<style scoped>
.battle { display: flex; flex-direction: column; min-height: 100%; padding: var(--space-3); }
.list { min-width: 0; }
.empty { padding: var(--space-5); color: var(--c-text-dim); text-align: center; }
</style>

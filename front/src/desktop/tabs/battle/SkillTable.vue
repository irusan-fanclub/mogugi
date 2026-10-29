<script lang="ts">
import { ref as sharedRef } from 'vue';

// One ＋ popover open at a time across every player's table.
const openPlus = sharedRef<{ owner: symbol; skillId: number } | null>(null);
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { getMabiNameColor, humanReadableNumber } from '@/lib/util';
import type { DetailColumn } from '@/lib/skillColumns';
import { buildSkillRows, limitRows, type SkillRow } from '@/lib/skillRows';
import { CC_MERGE_MAP } from '@/lib/effectTimeline';
import { skillCcCoverage } from '@/lib/skillCcCoverage';
import { plusCandidates } from '@/lib/skillCcCandidates';
import { ARCANA_NAMES, type ArcanaId } from '@/lib/arcanaTable';
import { effectiveSkillCcs } from '@/lib/skillCcLists';
import type { EntityConditionState, EntityDamage } from '@/eventActor';
import { useContextMenu, type MenuItem } from '../../ui/useContextMenu';
import {
    setSkillCcList, skillCcModel,
} from './skillCcSettings';
import CcIconGrid from './CcIconGrid.vue';
import SkillDetailLines, { type DetailLine } from './SkillDetailLines.vue';
import { numWidth } from './playerColumns';
import type { PlayerVM } from './battleTypes';

const props = defineProps<{
    vm: PlayerVM;
    columns: DetailColumn[];
    /** 0 = unlimited */
    limit: number;
    showAll: boolean;
    showPet: boolean;
    minAt: number | null;
    maxAt: number | null;
    skillName: (id: number) => string;
    /** 詳細 mode: a detail block under each skill row. */
    detailed: boolean;
    /** Boss history for the hit's target, or the player's own for common/arcana. */
    historyOf: (section: 'boss' | 'self', hit: EntityDamage) => EntityConditionState[];
    /** CCs seen in the fight on the targets hit / on the player; unseen ones are hidden. */
    seen: { boss: Set<number>; self: Set<number> };
}>();
const emit = defineEmits<{
    hits: [skillId: number];
    menu: [e: MouseEvent, row: SkillRow];
    toggleAll: [];
    'update:detailed': [value: boolean];
}>();

const all = computed(() => buildSkillRows({
    damages: props.vm.damages,
    skillUses: props.vm.skillUses,
    showPet: props.showPet,
    minAt: props.minAt,
    maxAt: props.maxAt,
    skillName: props.skillName,
    playerSpanSec: props.vm.spanSec,
    activeSec: props.vm.activeSec,
    excluded: props.vm.excluded,
    totalDamage: props.vm.total,
}));
const limited = computed(() => limitRows(all.value, props.limit, props.showAll));

// The last four tracks reuse the player row's widths; the table shares the row's
// padding and gap, so those columns share right edges with it.
const cols = computed(() => ['minmax(120px,1fr)', '60px']
    .concat(props.columns.map(c => `${c.width}px`))
    .concat((['total', 'dps', 'active', 'share'] as const).map(numWidth))
    .join(' '));

// A player's merged lists (通用 + 秘法), filtered by what was seen on this player's fight.
const effective = computed(() => effectiveSkillCcs(skillCcModel.value, props.vm.arcana || null));
const slots = computed(() => {
    const keep = (ids: number[], side: 'boss' | 'self') => ids.filter(id => props.seen[side].has(CC_MERGE_MAP[id] ?? id));
    return { boss: keep(effective.value.boss, 'boss'), self: keep(effective.value.self, 'self') };
});

// Every skill row renders every slot, so the same CC lines up down the table.
const linesBySkill = computed(() => {
    const out = new Map<number, DetailLine[]>();
    if (!props.detailed) return out;
    const defs = [
        { key: 'boss' as const, ids: slots.value.boss },
        { key: 'self' as const, ids: slots.value.self },
    ].filter(d => d.ids.length > 0);
    for (const row of limited.value.rows) {
        const sections = defs.map(d => ({
            key: d.key,
            chips: skillCcCoverage({ hits: row.hits, ccIds: d.ids, historyOf: h => props.historyOf(d.key, h) }),
        }));
        // Always present so the ＋ stays reachable even with nothing tracked yet.
        out.set(row.skillId, [{ key: 'cc', label: 'CC 覆蓋', sections }]);
    }
    return out;
});

const ctx = useContextMenu();
const arcanaName = () => (props.vm.arcana ? ARCANA_NAMES[props.vm.arcana as ArcanaId] : undefined);
const canon = (id: number) => CC_MERGE_MAP[id] ?? id;
const KIND_LABEL = { boss: 'BOSS', self: '自身' } as const;

// ＋ popover: seen-but-untracked CCs, one popover open at a time.
const uid = Symbol('skillTable');
const plusFor = computed(() => (openPlus.value?.owner === uid ? openPlus.value.skillId : null));
const candidates = computed(() => plusCandidates({
    targetSeen: props.seen.boss, selfSeen: props.seen.self,
    boss: effective.value.boss, common: effective.value.self, arcana: null,
}));

// Fixed to the viewport (teleported), so the table's scroller never clips it.
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
    // Flip above the button when there is no room below.
    if (top + p.height > window.innerHeight - EDGE) top = Math.max(EDGE, a.top - p.height - GAP);
    const left = Math.max(EDGE, Math.min(a.left, window.innerWidth - p.width - EDGE));
    pos.value = { left, top };
}
function togglePlus(e: MouseEvent, skillId: number) {
    if (plusFor.value === skillId) { openPlus.value = null; return; }
    anchor.value = e.currentTarget as HTMLElement;
    openPlus.value = { owner: uid, skillId };
    place();
}
function onPointerDown(e: Event) {
    if (plusFor.value === null) return;
    const t = e.target as Element | null;
    if (t && (pop.value?.contains(t) || t.closest?.('.cc-plus'))) return;
    openPlus.value = null;
}
// Capture phase so Esc closes the popover before a dialog underneath sees it.
function onKey(e: KeyboardEvent) {
    if (plusFor.value !== null && e.key === 'Escape') {
        e.stopPropagation();
        openPlus.value = null;
    }
}
onMounted(() => {
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
});
onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (openPlus.value?.owner === uid) openPlus.value = null;
});

function pickCandidate(e: MouseEvent, kind: 'boss' | 'self', id: number) {
    const m = skillCcModel.value;
    const items: MenuItem[] = [
        { label: '加到通用', action: () => setSkillCcList('common', kind, [...m.common[kind], id]) },
    ];
    const an = arcanaName();
    const a = props.vm.arcana;
    if (an && a) {
        items.push({ label: `加到〈${an}〉`, action: () => setSkillCcList(a, kind, [...(m.arcana[a]?.[kind] ?? []), id]) });
    }
    ctx.open(e, items);
}

function chipMenu(e: MouseEvent, section: string, id: number) {
    if (section !== 'boss' && section !== 'self') return;
    const kind = section;
    const m = skillCcModel.value;
    const drop = (l: number[]) => l.filter(x => canon(x) !== canon(id));
    const has = (l: number[]) => l.some(x => canon(x) === canon(id));
    const items: MenuItem[] = [];
    if (has(m.common[kind])) {
        items.push({ label: `從通用 ${KIND_LABEL[kind]} 移除`, action: () => setSkillCcList('common', kind, drop(m.common[kind])) });
    }
    const a = props.vm.arcana;
    if (a && has(m.arcana[a]?.[kind] ?? [])) {
        items.push({
            label: `從〈${arcanaName() ?? ''}〉${KIND_LABEL[kind]} 移除`,
            action: () => setSkillCcList(a, kind, drop(m.arcana[a]?.[kind] ?? [])),
        });
    }
    if (items.length) ctx.open(e, items);
}

const pct = (v: number) => `${(100 * v).toFixed(1)}%`;
</script>

<template>
  <div class="skill-table">
    <div class="grid" :style="{ '--cols': cols }">
      <div class="srow head">
        <span class="seg">
          <button type="button" :class="{ on: !detailed }" @click="emit('update:detailed', false)">精簡</button>
          <button type="button" :class="{ on: detailed }" @click="emit('update:detailed', true)">詳細</button>
        </span>
        <span class="r">命中次數</span>
        <span v-for="c in columns" :key="c.key" class="r faint">{{ c.label }}</span>
        <span class="r">總傷害</span>
        <span class="r">DPS</span>
        <span class="r" title="技能活躍傷害 ÷ 玩家活躍秒數（排除開場 5 秒、BOSS 無敵與死亡）">活躍DPS</span>
        <span class="r">佔比</span>
      </div>
      <template v-for="row in limited.rows" :key="row.skillId">
        <div class="skill-group">
          <div class="fill" :style="{ width: `${Math.round(100 * row.share)}%`, background: getMabiNameColor(row.name) }" />
          <div
            class="srow skill-row"
            :data-skill="row.skillId"
            @click="emit('hits', row.skillId)"
            @contextmenu="emit('menu', $event, row)"
          >
            <span class="name">
              <img :src="`/icons/skill/${row.skillId}.png`" width="20" height="20" alt="">
              <span class="txt" :title="row.name">{{ row.name }}</span>
            </span>
            <span class="r num dim">{{ row.count }}</span>
            <span v-for="c in columns" :key="c.key" class="r num faint">{{ row.cells[c.key] }}</span>
            <span class="r num total">{{ humanReadableNumber(row.damage) }}</span>
            <span class="r num dps">{{ humanReadableNumber(row.dps) }}</span>
            <span class="r num active">{{ row.activeDps === null ? '-' : humanReadableNumber(row.activeDps) }}</span>
            <span class="r num share">{{ pct(row.share) }}</span>
          </div>
          <SkillDetailLines v-if="detailed" :lines="linesBySkill.get(row.skillId) ?? []" :data-skill="row.skillId" @chip-menu="chipMenu">
            <template #end-cc>
              <span class="plus-wrap">
                <button
                  type="button"
                  class="cc-plus"
                  title="加入 CC"
                  aria-haspopup="true"
                  :aria-expanded="plusFor === row.skillId"
                  @click.stop="togglePlus($event, row.skillId)"
                >＋</button>
                <Teleport to="body">
                  <div
                    v-if="plusFor === row.skillId"
                    :ref="(el: unknown) => (pop = el as HTMLElement | null)"
                    class="cc-pop"
                    :style="{ position: 'fixed', left: `${pos.left}px`, top: `${pos.top}px` }"
                    @click.stop
                  >
                    <div class="pop-title">BOSS 身上出現過</div>
                    <CcIconGrid :ids="candidates.boss" empty-text="沒有可加入的 CC" @pick="(id, e) => pickCandidate(e, 'boss', id)" />
                    <div class="pop-title">這個角色身上出現過</div>
                    <CcIconGrid :ids="candidates.self" empty-text="沒有可加入的 CC" @pick="(id, e) => pickCandidate(e, 'self', id)" />
                  </div>
                </Teleport>
              </span>
            </template>
          </SkillDetailLines>
        </div>
      </template>
      <div v-if="limit > 0 && all.length > limit" class="skill-more" @click.stop="emit('toggleAll')">
        {{ showAll ? `收合（顯示前 ${limit} 個）` : `顯示全部 ${all.length} 個技能` }}
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Optional columns can exceed a narrow window; scroll here, never the page. */
.skill-table {
    /* Joined under the player's share bar: no gap, top corners square. */
    margin: 0;
    overflow-x: auto;
    border-radius: 0 0 var(--radius) var(--radius);
    background: var(--c-bg-deep);
}
.grid { width: max-content; min-width: 100%; }
.srow {
    position: relative;
    display: grid;
    grid-template-columns: var(--cols);
    align-items: center;
    column-gap: var(--space-3);
    height: var(--row-h);
    padding: 0 var(--space-3);
}
.head { color: var(--c-text-dim); font-size: var(--fs-sm); }
.skill-row { cursor: pointer; }
/* The group owns the share fill, so it spans the skill row and its detail block. */
.skill-group { position: relative; }
.skill-group:hover { background: var(--c-surface); }
.fill { position: absolute; inset: 0 auto 0 0; opacity: 0.4; pointer-events: none; z-index: 0; }
.skill-group > :not(.fill) { position: relative; z-index: 1; }
.name { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.name img { flex: none; border-radius: 2px; }
.txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.seg { display: inline-flex; justify-self: start; border: 1px solid var(--c-line); border-radius: var(--radius); overflow: hidden; }
.seg button {
    padding: 0 var(--space-3);
    border: 0;
    background: transparent;
    color: var(--c-text-dim);
    font: inherit;
    cursor: pointer;
}
.seg button.on { background: var(--c-surface); color: var(--c-accent); }
.r { text-align: right; white-space: nowrap; }
.num { font-family: var(--font-num); }
.dim { color: var(--c-text-dim); }
.faint { color: var(--c-text-dim); opacity: 0.85; }
.total { color: var(--c-number); }
.dps, .active { color: var(--c-dps); }
.share { color: var(--c-share); }
.cc-plus {
    padding: 0 var(--space-2);
    border: 1px dashed var(--c-line);
    border-radius: var(--radius);
    background: transparent;
    color: var(--c-text-dim);
    font: inherit;
    cursor: pointer;
}
.cc-plus:hover { color: var(--c-accent); border-color: var(--c-accent); }
.plus-wrap { position: relative; display: inline-flex; }
.cc-pop {
    z-index: 2500;
    display: flex; flex-direction: column; gap: var(--space-2);
    width: max-content; max-width: 280px; padding: var(--space-3);
    border: 1px solid var(--c-line); border-radius: var(--radius);
    background: var(--c-bg); box-shadow: 0 4px 12px rgb(0 0 0 / 30%);
}
.pop-title { font-size: var(--fs-xs); color: var(--c-text-dim); }
.skill-more {
    padding: var(--space-2) var(--space-3);
    color: var(--c-text-dim);
    text-align: center;
    cursor: pointer;
}
.skill-more:hover { color: var(--c-text); }
</style>

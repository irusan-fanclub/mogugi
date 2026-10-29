<script setup lang="ts">
import { computed, ref } from 'vue';
import { region, condNameMap } from '@/store';
import { availableCCs, reorder } from '@/lib/ccTracking';
import { ARCANA_NAMES } from '@/lib/arcanaTable';
import { arcanaIconUrl } from '@/lib/arcana';
import { ccIconUrl, ccName } from '@/lib/util';
import type { SkillCcSeen } from '@/lib/skillCcSeen';
import DButton from '../../ui/DButton.vue';
import DIconButton from '../../ui/DIconButton.vue';
import DSwitch from '../../ui/DSwitch.vue';
import DTextField from '../../ui/DTextField.vue';
import DSegmented from '../../ui/DSegmented.vue';
import DReorderList from '../../ui/DReorderList.vue';
import CcPicker from './CcPicker.vue';
import { ccPickMode, setCcPickMode, PICK_MODE_OPTIONS } from './ccPickMode';
import {
    skillCcModel, setSkillCcList, resetSkillCcList,
} from './skillCcSettings';

const props = defineProps<{ seen: SkillCcSeen }>();

type Owner = 'common' | number;
type Kind = 'boss' | 'self';
const owner = ref<Owner>('common');
const addTo = ref<Kind>('boss');
const seenOnly = ref(true);
const search = ref('');

const KINDS: { kind: Kind; label: string }[] = [
    { kind: 'boss', label: 'BOSS' },
    { kind: 'self', label: '自身' },
];
const targetOptions = KINDS.map(k => ({ value: k.kind, label: k.label }));

const arcanaIds = Object.keys(ARCANA_NAMES).map(Number);
const listOf = (o: Owner, k: Kind): number[] =>
    (o === 'common' ? skillCcModel.value.common : skillCcModel.value.arcana[o])?.[k] ?? [];
const navItems = computed(() => [
    { owner: 'common' as Owner, label: '通用', icon: '' },
    ...arcanaIds.map(a => ({ owner: a as Owner, label: ARCANA_NAMES[a], icon: arcanaIconUrl(a) })),
].map(n => ({ ...n, count: listOf(n.owner, 'boss').length + listOf(n.owner, 'self').length })));

const arcanaName = computed(() => (typeof owner.value === 'number' ? ARCANA_NAMES[owner.value] : ''));
const labelOf = (id: number) => `${ccName(condNameMap.value, id)} ${id}`;
const itemsOf = (k: Kind) => listOf(owner.value, k).map(id => ({ key: id, label: labelOf(id), icon: ccIconUrl(region.value, id) }));
const sections = computed(() => KINDS.map(k => ({ ...k, items: itemsOf(k.kind) })));

const setList = (k: Kind, list: number[]) => setSkillCcList(owner.value, k, list);
const onReorder = (k: Kind, from: number, to: number) => setList(k, reorder(listOf(owner.value, k), from, to, 0));
const remove = (k: Kind, id: number) => setList(k, listOf(owner.value, k).filter(x => x !== id));

// BOSS: seen on any target; 自身: seen on players (通用) or on players of that arcana.
const seenIds = computed((): number[] => {
    const o = owner.value;
    if (addTo.value === 'boss') return [...props.seen.boss];
    return o === 'common' ? [...props.seen.common] : [...(props.seen.arcana[o]?.keys() ?? [])];
});
const candidates = computed(() => availableCCs({
    tracked: listOf(owner.value, addTo.value),
    targetCCIds: seenIds.value,
    catalogue: seenOnly.value ? null : Object.keys(condNameMap.value).map(Number),
    search: search.value,
    nameOf: id => ccName(condNameMap.value, id),
    defaults: [],
}));
const add = (id: number) => {
    const cur = listOf(owner.value, addTo.value);
    if (!cur.includes(id)) setList(addTo.value, [...cur, id]);
};
const titleOf = (id: number) => {
    const n = typeof owner.value === 'number' && addTo.value === 'self'
        ? props.seen.arcana[owner.value]?.get(id) ?? 0 : 0;
    return n > 0 ? `${labelOf(id)}（出現在 ${n} 位${arcanaName.value}）` : labelOf(id);
};
</script>

<template>
  <div class="skillcc">
    <nav class="nav">
      <div
        v-for="n in navItems"
        :key="String(n.owner)"
        class="navitem"
        :class="{ on: n.owner === owner }"
        data-nav
        @click="owner = n.owner"
      >
        <img v-if="n.icon" :src="n.icon" width="16" height="16" alt="">
        <span class="grow">{{ n.label }}</span>
        <span class="cnt">{{ n.count }}</span>
      </div>
    </nav>
    <div class="right">
      <section v-for="s in sections" :key="s.kind" class="block lists" :data-section="s.kind">
        <div class="sub">
          <span>{{ s.label }}</span>
          <DButton size="sm" data-reset @click="resetSkillCcList(owner, s.kind)">重設</DButton>
        </div>
        <div class="scroll fill">
          <DReorderList :items="s.items" @reorder="(f, t) => onReorder(s.kind, f, t)">
            <template #actions="{ item }">
              <DIconButton icon="mdi-close" title="移除" data-remove @click="remove(s.kind, item.key as number)" />
            </template>
          </DReorderList>
          <div v-if="s.items.length === 0" class="note">這個清單目前是空的</div>
        </div>
      </section>
      <section class="block adder">
        <div class="sub">
          <div class="addhead">
            <span>新增狀態</span>
            <span>加到：</span>
            <DSegmented v-model="addTo" :options="targetOptions" />
          </div>
          <div class="addhead">
            <DSegmented :model-value="ccPickMode" :options="PICK_MODE_OPTIONS" data-pick-mode @update:model-value="setCcPickMode" />
            <DSwitch v-model="seenOnly" label="只顯示這場出現過" />
          </div>
        </div>
        <DTextField v-model="search" clearable placeholder="搜尋 CC（名稱或編號）" />
        <div class="scroll fill">
          <CcPicker :ids="candidates.list" :overflow="candidates.overflow" :title-of="titleOf" row-attr="data-skill-add" @pick="add" />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* Fills the dialog body: the lists and the grid scroll internally, nothing is cut off. */
.skillcc { display: flex; gap: var(--space-4); min-width: 0; flex: 1; min-height: 0; }
.nav { width: 180px; flex: none; display: flex; flex-direction: column; gap: 2px; border-right: 1px solid var(--c-line); padding-right: var(--space-3); overflow-y: auto; }
.navitem { display: flex; align-items: center; gap: var(--space-3); min-height: var(--row-h); padding: 0 var(--space-3); border-radius: var(--radius); font-size: var(--fs-sm); cursor: pointer; }
.navitem:hover { background: var(--c-surface-2); }
.navitem.on { background: var(--c-surface-2); color: var(--c-accent); }
.navitem img { border-radius: 2px; }
.cnt { color: var(--c-text-dim); font-size: var(--fs-xs); }
.right { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: var(--space-3); }
.block { display: flex; flex-direction: column; gap: var(--space-2); min-height: 0; }
.lists { flex: 0 1 auto; max-height: 40%; }
.adder { flex: 1; }
.sub {
    display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); flex-wrap: wrap;
    padding-bottom: var(--space-2); border-bottom: 1px solid var(--c-line);
    color: var(--c-text); font-size: var(--fs-md); font-weight: 600;
}
.sub :deep(label), .sub :deep([role="switch"]), .sub :deep(.d-segmented) { font-weight: normal; }
.scroll { overflow-y: auto; }
.fill { flex: 1; min-height: 0; }
.lists .fill { flex: 0 1 auto; }
.addhead { display: flex; align-items: center; gap: var(--space-3); }
.grow { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note { padding: var(--space-3); color: var(--c-text-dim); font-size: var(--fs-sm); }
</style>

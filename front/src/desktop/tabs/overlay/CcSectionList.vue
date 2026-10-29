<script setup lang="ts">
import { computed, ref } from 'vue';
import { region, condNameMap } from '@/store';
import { availableCCs, reorder } from '@/lib/ccTracking';
import { ccIconUrl, ccName } from '@/lib/util';
import DButton from '../../ui/DButton.vue';
import DIconButton from '../../ui/DIconButton.vue';
import DTextField from '../../ui/DTextField.vue';
import DReorderList from '../../ui/DReorderList.vue';

const props = defineProps<{ title: string; ids: number[]; defaults: number[] }>();
const emit = defineEmits<{ 'update:ids': [ids: number[]] }>();

const label = (id: number) => `${ccName(condNameMap.value, id)} ${id}`;
const items = computed(() => props.ids.map(id => ({
    key: id,
    label: label(id),
    icon: ccIconUrl(region.value, id),
})));

const search = ref('');
const adding = ref(false);
const result = computed(() => availableCCs({
    tracked: props.ids,
    targetCCIds: [],
    defaults: props.defaults,
    catalogue: Object.keys(condNameMap.value).map(Number),
    search: search.value,
    nameOf: id => ccName(condNameMap.value, id),
}));

const onReorder = (from: number, to: number) => emit('update:ids', reorder(props.ids, from, to, 0));
const remove = (id: number) => emit('update:ids', props.ids.filter(x => x !== id));
const add = (id: number) => { if (!props.ids.includes(id)) emit('update:ids', [...props.ids, id]); };
const reset = () => emit('update:ids', [...props.defaults]);
</script>

<template>
  <section class="cc-section" data-cc-section>
    <div class="head">
      <span class="title">{{ title }}</span>
      <span class="grow" />
      <DButton size="sm" @click="adding = !adding">{{ adding ? '完成' : '新增' }}</DButton>
      <DButton size="sm" @click="reset">恢復預設</DButton>
    </div>
    <div v-if="ids.length === 0" class="note">尚未追蹤任何狀態</div>
    <DReorderList :items="items" @reorder="onReorder">
      <template #actions="{ item }">
        <DIconButton icon="mdi-close" title="移除" data-remove @click="remove(item.key as number)" />
      </template>
    </DReorderList>
    <template v-if="adding">
      <DTextField v-model="search" clearable placeholder="搜尋 CC（名稱或編號）" />
      <div class="scroll">
        <div v-for="id in result.list" :key="id" class="addrow" data-add @click="add(id)">
          <i class="mdi mdi-plus dim" />
          <img :src="ccIconUrl(region, id)" width="16" height="16" alt="">
          <span>{{ label(id) }}</span>
        </div>
        <div v-if="result.overflow > 0" class="note" data-overflow>還有 {{ result.overflow }} 筆，請用搜尋縮小範圍</div>
        <div v-if="result.list.length === 0" class="note" data-empty>沒有更多可新增的狀態</div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.cc-section { display: flex; flex-direction: column; gap: var(--space-2); }
.head { display: flex; align-items: center; gap: var(--space-3); }
.title { font-size: var(--fs-md); font-weight: 600; }
.grow { flex: 1; }
.scroll { max-height: 220px; overflow-y: auto; }
.addrow { display: flex; align-items: center; gap: var(--space-3); min-height: var(--row-h); padding: 0 var(--space-3); font-size: var(--fs-sm); cursor: pointer; }
.addrow:hover { background: var(--c-surface-2); }
.addrow img { border-radius: 2px; }
.dim { color: var(--c-text-dim); }
.note { padding: var(--space-3); color: var(--c-text-dim); font-size: var(--fs-sm); }
</style>

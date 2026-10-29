<script setup lang="ts">
import { computed } from 'vue';
import { raceNameMap } from '@/store';
import { matchesRaceQuery, parseRaceIdInput } from '@/lib/bossRaces';
import DIconButton from '../../ui/DIconButton.vue';
import DMultiSelect, { type MultiItem } from '../../ui/DMultiSelect.vue';

// A list of race ids with delete buttons, plus a race search to add one; rowAttr tags the rows.
const props = defineProps<{ ids: number[]; rowAttr: string; emptyText?: string }>();
const emit = defineEmits<{ add: [id: number]; remove: [id: number] }>();

const sorted = computed(() => [...props.ids].sort((a, b) => a - b));
const raceItems = computed((): MultiItem[] =>
    Object.entries(raceNameMap.value).map(([id, title]) => ({ value: Number(id), title })));
const raceFilter = (item: MultiItem, q: string) => matchesRaceQuery(item.title, Number(item.value), q);
function onPick(v: (string | number)[]) {
    if (v.length) emit('add', Number(v[0]));
}
// A bare number the table does not know can still be listed.
function onSubmit(text: string) {
    const id = parseRaceIdInput(text);
    if (id !== null) emit('add', id);
}
</script>

<template>
  <div class="races">
    <div v-if="sorted.length === 0 && emptyText" class="empty">{{ emptyText }}</div>
    <div v-for="id in sorted" :key="id" class="row" v-bind="{ [rowAttr]: '' }">
      <span class="name">{{ raceNameMap[id] ?? `RaceID ${id}` }}</span>
      <DIconButton icon="mdi-delete" title="移除" @click="emit('remove', id)" />
    </div>
    <div class="add">
      <DMultiSelect
        class="grow"
        :model-value="[]"
        :items="raceItems"
        :max="1"
        :filter="raceFilter"
        placeholder="搜尋種族（中文或 RaceID），打 RaceID 按 Enter 直接加入"
        @update:model-value="onPick"
        @submit="onSubmit"
      />
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.races { display: flex; flex-direction: column; }
.row { display: flex; align-items: center; gap: var(--space-3); height: 24px; padding: 0 var(--space-3); font-size: var(--fs-sm); }
.row:hover { background: var(--c-surface-2); }
.row :deep(.d-icon-btn) { width: 20px; height: 20px; font-size: var(--fs-sm); }
.name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { padding: var(--space-2) var(--space-3); color: var(--c-text-dim); font-size: var(--fs-sm); }
.add { display: flex; align-items: flex-start; gap: var(--space-3); margin-top: var(--space-2); }
.grow { flex: 1; min-width: 0; }
</style>

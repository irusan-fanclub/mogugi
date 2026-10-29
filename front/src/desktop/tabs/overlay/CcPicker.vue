<script setup lang="ts">
import { computed, ref } from 'vue';
import { region, condNameMap } from '@/store';
import { availableCCs } from '@/lib/ccTracking';
import { ccIconUrl, ccName } from '@/lib/util';
import DButton from '../../ui/DButton.vue';
import DTextField from '../../ui/DTextField.vue';

const model = defineModel<number>({ required: true });

const open = ref(false);
const search = ref('');
const result = computed(() => availableCCs({
    tracked: [],
    targetCCIds: [],
    defaults: [],
    catalogue: Object.keys(condNameMap.value).map(Number),
    search: search.value,
    nameOf: id => ccName(condNameMap.value, id),
}));

const pick = (id: number) => { model.value = id; open.value = false; search.value = ''; };
</script>

<template>
  <div class="cc-picker">
    <DButton size="sm" data-cc-picker-toggle @click="open = !open">
      <img :src="ccIconUrl(region, model)" width="16" height="16" alt="">
      <span>{{ ccName(condNameMap, model) }}</span>
    </DButton>
    <template v-if="open">
      <DTextField v-model="search" clearable placeholder="搜尋 CC（名稱或編號）" />
      <div class="scroll">
        <div v-for="id in result.list" :key="id" class="addrow" data-pick @click="pick(id)">
          <img :src="ccIconUrl(region, id)" width="16" height="16" alt="">
          <span>{{ ccName(condNameMap, id) }} {{ id }}</span>
        </div>
        <div v-if="result.overflow > 0" class="note">還有 {{ result.overflow }} 筆，請用搜尋縮小範圍</div>
        <div v-if="result.list.length === 0" class="note">沒有符合的狀態</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cc-picker { display: flex; flex-direction: column; gap: var(--space-2); align-items: flex-start; min-width: 0; }
.cc-picker :deep(.d-field) { align-self: stretch; }
.scroll { align-self: stretch; max-height: 200px; overflow-y: auto; }
.addrow { display: flex; align-items: center; gap: var(--space-3); min-height: var(--row-h); padding: 0 var(--space-3); font-size: var(--fs-sm); cursor: pointer; }
.addrow:hover { background: var(--c-surface-2); }
img { border-radius: 2px; }
.note { padding: var(--space-3); color: var(--c-text-dim); font-size: var(--fs-sm); }
</style>

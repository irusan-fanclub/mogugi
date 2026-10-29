<script setup lang="ts">
import { condNameMap, region } from '@/store';
import { ccIconUrl, ccName } from '@/lib/util';
import CcIconGrid from './CcIconGrid.vue';
import { ccPickMode } from './ccPickMode';

// CCs to add, as an icon grid or as named rows; rowAttr tags each row for callers and tests.
const props = defineProps<{ ids: number[]; overflow?: number; titleOf?: (id: number) => string; rowAttr?: string }>();
const emit = defineEmits<{ pick: [id: number, e: MouseEvent]; menu: [id: number, e: MouseEvent] }>();
const EMPTY = '沒有更多可新增的狀態';
</script>

<template>
  <div class="picker">
    <CcIconGrid
      v-if="ccPickMode === 'icon'"
      :ids="ids"
      :title-of="titleOf"
      :empty-text="EMPTY"
      @pick="(id, e) => emit('pick', id, e)"
      @menu="(id, e) => emit('menu', id, e)"
    />
    <template v-else>
      <div
        v-for="id in ids"
        :key="id"
        class="addrow"
        v-bind="{ [props.rowAttr ?? 'data-add']: '' }"
        :title="titleOf?.(id)"
        @click="emit('pick', id, $event)"
        @contextmenu="emit('menu', id, $event)"
      >
        <i class="mdi mdi-plus dim" />
        <img :src="ccIconUrl(region, id)" width="16" height="16" alt="">
        <span>{{ ccName(condNameMap, id) }} {{ id }}</span>
      </div>
      <div v-if="ids.length === 0" class="note" data-empty>{{ EMPTY }}</div>
    </template>
    <div v-if="(overflow ?? 0) > 0" class="note" data-overflow>還有 {{ overflow }} 筆，請用搜尋縮小範圍</div>
  </div>
</template>

<style scoped>
.addrow { display: flex; align-items: center; gap: var(--space-3); min-height: var(--row-h); padding: 0 var(--space-3); font-size: var(--fs-sm); cursor: pointer; }
.addrow:hover { background: var(--c-surface-2); }
.addrow img { border-radius: 2px; }
.dim { color: var(--c-text-dim); }
.note { padding: var(--space-3); color: var(--c-text-dim); font-size: var(--fs-sm); }
</style>

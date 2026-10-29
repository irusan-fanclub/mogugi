<script setup lang="ts">
import { ref } from 'vue';
import { condNameMap, region } from '@/store';
import { ccIconUrl, ccName } from '@/lib/util';

const props = defineProps<{ ids: number[]; emptyText?: string; titleOf?: (id: number) => string; draggable?: boolean }>();
const titleFor = (id: number) => props.titleOf?.(id) ?? `${ccName(condNameMap.value, id)} ${id}`;
const emit = defineEmits<{
    pick: [id: number, e: MouseEvent];
    menu: [id: number, e: MouseEvent];
    reorder: [from: number, to: number];
}>();

// Live reorder while hovering, like DReorderList; a drag from another grid is ignored.
const dragIdx = ref(-1);
function onDragStart(e: DragEvent, i: number) {
    dragIdx.value = i;
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(props.ids[i]));
    }
}
function onDragOver(e: DragEvent, i: number) {
    if (dragIdx.value < 0) return;
    e.preventDefault();
    if (i === dragIdx.value) return;
    emit('reorder', dragIdx.value, i);
    dragIdx.value = i;
}
</script>

<template>
  <div class="cc-grid">
    <button
      v-for="(id, i) in ids"
      :key="id"
      type="button"
      class="cc-btn"
      :class="{ dragging: dragIdx === i }"
      :data-cc="id"
      :title="titleFor(id)"
      :draggable="draggable ? 'true' : undefined"
      @click="emit('pick', id, $event)"
      @contextmenu="emit('menu', id, $event)"
      @dragstart="draggable && onDragStart($event, i)"
      @dragover="draggable && onDragOver($event, i)"
      @dragend="dragIdx = -1"
    >
      <img :src="ccIconUrl(region, id)" width="20" height="20" alt="" draggable="false">
    </button>
    <span v-if="ids.length === 0 && emptyText" class="empty">{{ emptyText }}</span>
  </div>
</template>

<style scoped>
.cc-grid { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.cc-btn { padding: 2px; border: 1px solid transparent; border-radius: var(--radius); background: transparent; cursor: pointer; line-height: 0; }
.cc-btn.dragging { opacity: 0.4; }
.cc-btn:hover { border-color: var(--c-accent); background: var(--c-surface); }
.cc-btn img { border-radius: 2px; }
.empty { font-size: var(--fs-xs); color: var(--c-text-dim); }
</style>

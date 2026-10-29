<script lang="ts">
export interface ReorderItem {
    key: string | number;
    label: string;
    /** Image URL shown at 16px. */
    icon?: string;
    checked?: boolean;
}
</script>

<script setup lang="ts">
import { ref } from 'vue';
import DCheckbox from './DCheckbox.vue';

const props = defineProps<{ items: ReorderItem[]; checkable?: boolean }>();
const emit = defineEmits<{ reorder: [from: number, to: number]; toggle: [key: string | number] }>();

const dragIdx = ref(-1);

function onDragStart(e: DragEvent, i: number) {
    dragIdx.value = i;
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(props.items[i].key));
    }
}
// Live reorder while hovering, like the web dialog; the parent persists on each emit.
function onDragOver(e: DragEvent, i: number) {
    e.preventDefault();
    const from = dragIdx.value;
    if (from < 0) return;
    const to = i;
    if (to === from) return;
    emit('reorder', from, to);
    dragIdx.value = to;
}
function onDragEnd() { dragIdx.value = -1; }
</script>

<template>
  <div class="d-reorder" role="list">
    <div
      v-for="(it, i) in items"
      :key="it.key"
      class="row"
      :class="{ dragging: dragIdx === i }"
      role="listitem"
      draggable="true"
      @dragstart="onDragStart($event, i)"
      @dragover="onDragOver($event, i)"
      @dragend="onDragEnd"
    >
      <i class="mdi mdi-drag-horizontal-variant handle" />
      <DCheckbox v-if="checkable" :model-value="!!it.checked" @update:model-value="emit('toggle', it.key)" />
      <img v-if="it.icon" class="icon" :src="it.icon" width="16" height="16" alt="">
      <span class="label"><slot name="label" :item="it" :index="i">{{ it.label }}</slot></span>
      <slot name="actions" :item="it" :index="i" />
    </div>
  </div>
</template>

<style scoped>
.row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--row-h);
    padding: 0 var(--space-3);
    cursor: grab;
    user-select: none;
}
.row.dragging { background: var(--c-surface-2); opacity: 0.5; }
.handle { color: var(--c-text-dim); opacity: 0.6; }
.icon { flex: none; border-radius: 2px; }
.label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-sm); }
</style>

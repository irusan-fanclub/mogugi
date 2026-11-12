<script setup lang="ts">
import { computed } from 'vue';
import type { GridRow } from '@/lib/memberGrid';
import type { SectionLook } from '@/lib/overlayFrames';
import Tile from './Tile.vue';
import { labelOf } from './sectionView';

const props = withDefaults(defineProps<{
    rows: GridRow[]; px: number; dim: number; look: SectionLook;
    editing?: boolean; lifted?: string[]; insertAt?: number | null;
}>(), { editing: false, lifted: () => [], insertAt: null });
const emit = defineEmits<{ 'tile-down': [key: string, e: PointerEvent] }>();

const isLifted = (c: GridRow['cells'][number]) => !!c && props.lifted.includes(c.key);
// A column whose every cell is empty or lifted is not drawn.
const shownCols = computed(() => {
    const n = props.rows[0]?.cells.length ?? 0;
    const out: number[] = [];
    for (let i = 0; i < n; i++) if (props.rows.some(r => r.cells[i] && !isLifted(r.cells[i]))) out.push(i);
    return out;
});
const cellsOf = (r: GridRow) => shownCols.value.map(i => (isLifted(r.cells[i]) ? null : r.cells[i]));
// Grid line of the bar: line 1-2 is the name column, so column n starts at line n + 2.
const barLine = computed(() => (props.insertAt === null ? 0 : Math.min(props.insertAt, shownCols.value.length) + 2));
</script>

<template>
  <div class="ov-members" :style="{ gridTemplateColumns: shownCols.length ? `max-content repeat(${shownCols.length}, max-content)` : 'max-content' }">
    <div v-for="r in rows" :key="r.holderId" class="ov-member-row" data-member-row>
      <span class="ov-member-name">{{ r.name }}</span>
      <template v-for="(c, i) in cellsOf(r)" :key="i">
        <Tile
          v-if="c" :tile="c" :px="px" :dim="dim" :editing="editing" :label="labelOf(c, look, true)" data-cell
          @tile-down="(k, e) => emit('tile-down', k, e)"
        />
        <div v-else class="ov-member-gap" data-cell />
      </template>
    </div>
    <div v-if="insertAt !== null" class="ov-col-bar" data-col-bar :style="{ gridColumn: `${barLine} / ${barLine}` }" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { GridRow } from '@/lib/memberGrid';
import type { SectionLook } from '@/lib/overlayFrames';
import Tile from './Tile.vue';
import { labelOf } from './sectionView';

const props = defineProps<{ rows: GridRow[]; px: number; dim: number; look: SectionLook }>();
const cols = computed(() => props.rows[0]?.cells.length ?? 0);
</script>

<template>
  <div class="ov-members" :style="{ gridTemplateColumns: `max-content repeat(${cols}, max-content)` }">
    <div v-for="r in rows" :key="r.holderId" class="ov-member-row" data-member-row>
      <span class="ov-member-name">{{ r.name }}</span>
      <template v-for="(c, i) in r.cells" :key="i">
        <Tile v-if="c" :tile="c" :px="px" :dim="dim" :editing="false" :label="labelOf(c, look, true)" data-cell />
        <div v-else class="ov-member-gap" data-cell />
      </template>
    </div>
  </div>
</template>

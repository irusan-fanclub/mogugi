<script setup lang="ts">
import type { GridRow } from '@/lib/memberGrid';
import type { SectionLook } from '@/lib/overlayFrames';
import Tile from './Tile.vue';
import { labelOf } from './sectionView';

defineProps<{ rows: GridRow[]; px: number; dim: number; look: SectionLook }>();
</script>

<template>
  <div class="ov-members">
    <div v-for="r in rows" :key="r.holderId" class="ov-member-row" data-member-row>
      <span class="ov-member-name">{{ r.name }}</span>
      <template v-for="(c, i) in r.cells" :key="i">
        <Tile v-if="c" :tile="c" :px="px" :dim="dim" :editing="false" :label="labelOf(c, look, true)" />
        <div v-else class="ov-member-gap" :style="{ width: px + 'px' }" />
      </template>
    </div>
  </div>
</template>

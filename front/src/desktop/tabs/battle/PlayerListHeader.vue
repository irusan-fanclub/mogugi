<script setup lang="ts">
import { musicWidth, PLAYER_NUM_COLUMNS } from './playerColumns';

// musicLeft: the rows' music cell offset (px from the row edge), measured by the tab; null keeps it beside the numbers.
defineProps<{ narrow: boolean; musicLeft?: number | null }>();
</script>

<template>
  <div class="head" data-player-head>
    <span
      class="lbl"
      :class="{ placed: musicLeft != null }"
      data-music-label
      :style="{ width: musicWidth(narrow), left: musicLeft != null ? `${musicLeft}px` : undefined }"
      title="音樂增益的數值；滑過格子看各段時間與覆蓋率"
    >音樂</span>
    <span class="spacer" />
    <span
      v-for="c in PLAYER_NUM_COLUMNS"
      :key="c.key"
      class="lbl num"
      :style="{ width: `${c.width}px` }"
      :title="c.title || undefined"
    >{{ c.label }}</span>
  </div>
</template>

<style scoped>
/* Same gap and padding as .player-row, so labels sit over their columns. */
.head {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0 var(--space-3) var(--space-1);
    color: var(--c-text-dim);
    font-size: var(--fs-xs);
    white-space: nowrap;
}
.spacer { flex: 1; min-width: 0; }
.lbl { flex: none; overflow: hidden; }
.num { text-align: right; }
.placed { position: absolute; top: 0; }
</style>

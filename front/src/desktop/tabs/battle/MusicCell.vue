<script setup lang="ts">
import { computed } from 'vue';
import type { MusicBuffCell } from '@/lib/musicBuff';
import { ccIconUrl, formatMinSec } from '@/lib/util';

// Presentation only: `cell` already carries every field to render.
const props = withDefaults(defineProps<{
    cell: MusicBuffCell;
    compact?: boolean;
    /** Fight-start second; value ranges print relative to it. */
    origin?: number;
    /** A 聖詠者 row: the gaps are the teammates' songs, so the jab goes to them. */
    bard?: boolean;
}>(), { origin: 0, bard: false });

const present = computed(() => props.cell.kind === 'present');
const iconUrl = computed(() => props.cell.kind === 'present' ? ccIconUrl('', props.cell.ccId) : '');
const songChanged = computed(() => props.cell.kind === 'present' && props.cell.songChanged);
const dim = computed(() => props.cell.kind === 'present' && !props.cell.isOn);

// Ranges are m:ss from the fight start, like the chart axis.
const rangeText = (r: [number, number]) => `${formatMinSec(r[0] - props.origin)}~${formatMinSec(r[1] - props.origin)}`;
const pctText = (p: number) => `${p.toFixed(1)}%`;
const overplayed = computed(() => props.cell.kind === 'present' && props.cell.runs.length >= 3);
// The cell shows the first and last value only; every run with its span goes in the tooltip.
const valueText = computed(() => {
    if (props.cell.kind !== 'present') return '';
    const { runs } = props.cell;
    const last = runs[runs.length - 1];
    const text = runs.length === 1 ? pctText(last.pct) : `${pctText(runs[0].pct)} → ${pctText(last.pct)}`;
    return overplayed.value ? `${text} 😠` : text;
});
const tip = computed(() => {
    if (props.cell.kind !== 'present') return undefined;
    const { runs, coverage } = props.cell;
    const parts = [`音樂增益，覆蓋 ${(100 * coverage).toFixed(1)}%`, ...runs.map(r => `${pctText(r.pct)}　${rangeText(r.range)}`)];
    if (overplayed.value) parts.push(props.bard ? '你隊友為什麼不續音樂' : '為什麼不續音樂、為什麼要死');
    return parts.join('\n');
});
</script>

<template>
  <span class="music" :class="{ compact }" :title="tip">
    <span v-if="!present" class="empty">—</span>
    <span v-else class="cell" :class="{ dim }">
      <span v-if="songChanged" class="chg">→</span>
      <img :src="iconUrl" width="16" height="16" class="icon" alt="">
      <span v-if="!compact" class="value">{{ valueText }}</span>
    </span>
  </span>
</template>

<style scoped>
.music {
    display: flex;
    align-items: center;
    flex: none;
    width: var(--music-w, 128px);
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
.music.compact { width: 24px; }
.empty { color: var(--c-text-dim); opacity: 0.6; }
.cell { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; }
.cell.dim { opacity: 0.45; }
.chg { color: var(--c-text-dim); }
.icon { border-radius: 2px; flex: none; }
.value { font-size: var(--fs-sm); overflow: hidden; text-overflow: ellipsis; }
</style>

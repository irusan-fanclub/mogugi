<script setup lang="ts">
import { condNameMap, region } from '@/store';
import { ccIconUrl, ccName } from '@/lib/util';
import { coverageColor } from '@/lib/effectTimeline';
import type { CcCover } from '@/lib/skillCcCoverage';

export interface DetailLine {
    key: string;
    label: string;
    /** Chip groups, drawn left to right with a divider between. A chip with total 0 is an empty slot. */
    sections: { key: string; chips: CcCover[] }[];
}

defineProps<{ lines: DetailLine[] }>();
const emit = defineEmits<{ chipMenu: [e: MouseEvent, section: string, ccId: number] }>();

const pctOf = (c: CcCover) => (c.total > 0 ? (100 * c.covered) / c.total : 0);
// Same format as the BOSS coverage row: one decimal, 100% without it.
function fmtPct(p: number): string {
    const s = p.toFixed(1);
    return (s === '100.0' ? '100' : s) + '%';
}
const title = (c: CcCover) => `${ccName(condNameMap.value, c.ccId)}：${c.covered} / ${c.total} 下（${pctOf(c).toFixed(1)}%）`;
</script>

<template>
  <div class="skill-detail">
    <div v-for="line in lines" :key="line.key" class="dline" :data-line="line.key">
      <span class="dl-label">{{ line.label }}</span>
      <template v-for="s in line.sections" :key="s.key">
        <span class="cc-sec" :data-sec="s.key">
          <template v-for="c in s.chips" :key="c.ccId">
            <span v-if="c.total === 0" class="chip empty" :data-cc="c.ccId" />
            <span v-else class="chip" :data-cc="c.ccId" :title="title(c)" @contextmenu="emit('chipMenu', $event, s.key, c.ccId)">
              <img :src="ccIconUrl(region, c.ccId)" width="14" height="14" alt="">
              <span class="pct" :class="coverageColor(Math.round(pctOf(c)))">{{ fmtPct(pctOf(c)) }}</span>
            </span>
          </template>
        </span>
      </template>
      <slot :name="`end-${line.key}`" />
    </div>
  </div>
</template>

<style scoped>
.skill-detail { padding: 0 var(--space-3) var(--space-2) calc(var(--space-3) + 28px); }
.dline { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-3); font-size: var(--fs-xs); color: var(--c-text-dim); }
.dl-label { flex: none; min-width: 52px; opacity: 0.85; }
.cc-sec { display: inline-flex; align-items: center; gap: var(--space-3); }
.cc-sec + .cc-sec { padding-left: var(--space-3); border-left: 1px solid var(--c-line); }
/* Fixed slot so the same CC lines up across a player's skill rows. */
.chip { display: inline-flex; align-items: center; gap: 3px; width: calc(14px + 3px + 3.4em); }
.chip img { border-radius: 2px; }
.pct { font-weight: 600; font-variant-numeric: tabular-nums; }
.pct.ok { color: var(--c-ok); }
.pct.warn { color: var(--c-warn); }
.pct.err { color: var(--c-err); }
</style>

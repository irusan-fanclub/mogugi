<script setup lang="ts">
import { computed } from 'vue';
import { condNameMap, region } from '@/store';
import { ccIconUrl, ccName } from '@/lib/util';
import type { CoverageRow } from '@/lib/effectTimeline';
import { GROUP_LABEL_FONT, GROUP_LABEL_X, ICON_LEFT, PLUS_H, PLUS_LEFT, PLUS_W } from '../../charts/dpsTimelineOption';
import { useContextMenu } from '../../ui/useContextMenu';
import { ccDropKey, ccGroupOf, ccIconDnd, ccMenuItems, type CcGroupKind } from './ccGroupActions';

const props = defineProps<{
    groups: { key?: 'boss' | 'self'; label: string; accent?: boolean; rows: CoverageRow[] }[];
    /** The group whose strip ＋ popover is open, for aria-expanded. */
    openGroup?: 'boss' | 'self' | null;
}>();
const emit = defineEmits<{ plus: [group: 'boss' | 'self', e: MouseEvent] }>();

// One label and ＋ per group, spanning (and centred on) its on-chart and coverage-only rows.
const strips = computed(() => props.groups.map(g => ({
    label: g.label, accent: g.accent, key: g.key,
    parts: [g.rows.filter(r => r.onChart), g.rows.filter(r => !r.onChart)].filter(p => p.length > 0),
})).filter(s => s.parts.length > 0));

const menu = useContextMenu();
const onMenu = (group: CcGroupKind, id: number, e: MouseEvent) => menu.open(e, ccMenuItems(ccGroupOf(group), id));
// Rows of a group without a key (none today) are plain cells.
const dndOf = (group: CcGroupKind | undefined, r: CoverageRow) => (group ? ccIconDnd(group, r.ccId, !r.onChart) : {});

// Latin reads rotated like the chart; CJK stacks one char per line (html2canvas lacks vertical writing).
const isLatin = (t: string) => /^[ -~]*$/.test(t);

// 100% drops the decimal so every cell keeps the same width.
function fmtPct(pct: number): string {
    const s = pct.toFixed(1);
    return (s === '100.0' ? '100' : s) + '%';
}
</script>

<template>
  <div
    v-if="strips.length"
    class="coverage"
    :style="{ '--icon-left': `${ICON_LEFT}px`, '--label-x': `${GROUP_LABEL_X}px`, '--label-px': `${GROUP_LABEL_FONT}px` }"
  >
    <div class="divider" />
    <div v-for="(s, i) in strips" :key="i" class="strip">
      <span class="label" :class="{ accent: s.accent }" :style="{ gridRow: `span ${s.parts.length}` }">
        <button
          v-if="s.key"
          type="button"
          class="strip-plus"
          data-html2canvas-ignore
          :data-strip-plus="s.key"
          :title="s.key === 'boss' ? '加入 BOSS 僅覆蓋率 CC' : '加入自身僅覆蓋率 CC'"
          aria-haspopup="true"
          :aria-expanded="openGroup === s.key"
          :style="{ left: `${PLUS_LEFT}px`, width: `${PLUS_W}px`, height: `${PLUS_H}px` }"
          @click.stop="emit('plus', s.key, $event)"
        >＋</button>
        <span v-if="s.label" class="glyphs" :class="{ rot: isLatin(s.label) }">
          <template v-if="isLatin(s.label)">{{ s.label }}</template>
          <span v-for="(c, k) in (isLatin(s.label) ? [] : [...s.label])" v-else :key="k" class="ch">{{ c }}</span>
        </span>
      </span>
      <div v-for="(rows, j) in s.parts" :key="j" class="cells">
        <span
          v-for="r in rows"
          :key="r.ccId"
          class="cell"
          :class="{ drop: s.key && ccDropKey === `${s.key}:${r.ccId}` }"
          :data-cov-cc="r.ccId"
          :draggable="s.key ? 'true' : undefined"
          :title="ccName(condNameMap, r.ccId) + ' ' + r.ccId + (s.key ? '（右鍵選單，拖曳排序）' : '')"
          @contextmenu="s.key && onMenu(s.key, r.ccId, $event)"
          v-on="dndOf(s.key, r)"
        >
          <img :src="ccIconUrl(region, r.ccId)" width="14" height="14" />
          <span class="pct" :class="r.color">{{ fmtPct(r.pct) }}</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* The label column is the timeline's left gutter, so strip icons start at the lane icon x. */
.coverage {
  display: grid; grid-template-columns: var(--icon-left) 1fr; align-items: center; gap: var(--space-1) 0;
  padding: 0 var(--space-4) var(--space-1) 0;
}
/* A real border, not a gradient: html2canvas drops repeating gradients. */
.divider {
  grid-column: 1 / -1; height: 0; margin: 0 calc(-1 * var(--space-4)) var(--space-1) 0;
  border-top: 1px dashed var(--c-line);
}
.strip { display: contents; }
.cells { grid-column: 2; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-1) var(--space-4); }
/* Mirrors the timeline group label: 9px sans-serif centred on --label-x, rotated like the chart (zrender rotation is CCW, so -90deg). */
.label {
  position: relative; align-self: stretch; min-height: var(--label-px);
  font: var(--label-px) / var(--label-px) sans-serif; color: var(--c-text-dim); white-space: nowrap;
}
.strip-plus {
  position: absolute; top: 50%; transform: translateY(-50%); padding: 0; line-height: 1; font-size: var(--fs-xs);
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px dashed var(--c-line); border-radius: var(--radius);
  background: var(--c-surface); color: var(--c-text-dim); cursor: pointer;
}
.strip-plus:hover { color: var(--c-accent); border-color: var(--c-accent); }
.glyphs { position: absolute; left: var(--label-x); top: 50%; display: flex; flex-direction: column; align-items: center; transform: translate(-50%, -50%); }
.glyphs.rot { transform: translate(-50%, -50%) rotate(-90deg); }
.label.accent { color: var(--c-accent); }
.cell { display: inline-flex; align-items: center; gap: 3px; border-radius: 2px; }
.cell[draggable="true"] { cursor: pointer; }
.cell.drop { outline: 2px solid var(--c-accent); }
.cell img { border-radius: 2px; }
.pct { width: 2.8em; text-align: right; font-size: var(--fs-xs); font-weight: 600; font-variant-numeric: tabular-nums; }
.pct.ok { color: var(--c-ok); }
.pct.warn { color: var(--c-warn); }
.pct.err { color: var(--c-err); }
</style>

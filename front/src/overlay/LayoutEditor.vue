<script setup lang="ts">
import type { Guide, Rect, Size } from '@/lib/overlayLayout';
import type { Anchor } from '@/lib/overlayProtocol';

export interface EditorComp { id: string; enabled: boolean; anchor: Anchor; rect: Rect; docked?: boolean }

const props = defineProps<{
    active: boolean;
    viewport: Size;
    scale: number;
    comps: EditorComp[];
    dragId: string | null;
    dragMode: 'move' | 'width' | null;
    cell: { col: number; row: number } | null;
    guides: Guide[];
    hotkey: string;
}>();
defineEmits<{ lock: []; reset: [] }>();

const ANCHORS: Anchor[] = ['tl', 'tr', 'bl', 'br', 'center'];

function anchorPoint(a: Anchor) {
    const { w, h } = props.viewport;
    return {
        x: a === 'tl' || a === 'bl' ? 0 : a === 'center' ? w / 2 : w,
        y: a === 'tl' || a === 'tr' ? 0 : a === 'center' ? h / 2 : h,
    };
}
function refPoint(c: EditorComp) {
    const { l, t, w, h } = c.rect;
    const a = c.anchor;
    return {
        x: l + (a === 'tl' || a === 'bl' ? 0 : a === 'center' ? w / 2 : w),
        y: t + (a === 'tl' || a === 'tr' ? 0 : a === 'center' ? h / 2 : h),
    };
}
const used = (a: Anchor) => props.comps.some(c => c.enabled && !c.docked && c.anchor === a);
</script>

<template>
  <template v-if="active">
    <div class="ov-mask" />
    <svg class="ov-fx" :viewBox="`0 0 ${viewport.w} ${viewport.h}`">
      <template v-if="dragMode === 'move'">
        <g data-grid>
          <line v-for="i in 2" :key="'v' + i" class="ov-grid-line" :x1="viewport.w * i / 3" y1="0" :x2="viewport.w * i / 3" :y2="viewport.h" />
          <line v-for="i in 2" :key="'h' + i" class="ov-grid-line" x1="0" :y1="viewport.h * i / 3" :x2="viewport.w" :y2="viewport.h * i / 3" />
        </g>
        <rect
          v-if="cell" class="ov-cell" data-cell
          :x="cell.col * viewport.w / 3" :y="cell.row * viewport.h / 3" :width="viewport.w / 3" :height="viewport.h / 3"
        />
      </template>
      <line class="ov-centre" :x1="viewport.w / 2" y1="0" :x2="viewport.w / 2" :y2="viewport.h" />
      <line class="ov-centre" x1="0" :y1="viewport.h / 2" :x2="viewport.w" :y2="viewport.h / 2" />
      <circle
        v-for="a in ANCHORS" :key="a" class="ov-dot" :class="{ used: used(a) }" data-dot
        :cx="anchorPoint(a).x" :cy="anchorPoint(a).y" :r="used(a) ? 7 : 4.5"
      />
      <template v-for="c in comps" :key="c.id">
        <line
          v-if="c.enabled && !c.docked && !(dragId === c.id && dragMode === 'move')" class="ov-link" data-link
          :x1="anchorPoint(c.anchor).x" :y1="anchorPoint(c.anchor).y" :x2="refPoint(c).x" :y2="refPoint(c).y"
        />
      </template>
    </svg>
  </template>
  <slot />
  <template v-if="active">
    <svg class="ov-fx" :viewBox="`0 0 ${viewport.w} ${viewport.h}`">
      <line
        v-for="(g, i) in guides" :key="i" class="ov-guide" :class="{ centre: g.centre }" data-guide
        :x1="g.x1" :y1="g.y1" :x2="g.x2" :y2="g.y2"
      />
    </svg>
    <div class="ov-toolbar">
      <button type="button" class="ov-tb-btn primary" data-lock @pointerdown.stop @click="$emit('lock')">鎖定（{{ hotkey }}）</button>
      <button type="button" class="ov-tb-btn" data-reset @pointerdown.stop @click="$emit('reset')">重設版面</button>
    </div>
  </template>
</template>

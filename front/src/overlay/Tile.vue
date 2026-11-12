<script setup lang="ts">
import type { TileVM } from '@/lib/overlayTiles';
import { ccIconUrl } from '@/lib/util';

const props = defineProps<{ tile: TileVM; px: number; dim: number; editing: boolean; label: string }>();
const emit = defineEmits<{ 'tile-down': [key: string, e: PointerEvent] }>();

const src = (t: TileVM) => t.icon.kind === 'skill' ? `/icons/skill/${t.icon.id}.png` : ccIconUrl('', t.icon.id);
// warn / safe / gone only light up with the highlight option; ready and cooling are always styled.
const cls = (t: TileVM) => ({
    [t.state]: t.state === 'ok' || t.state === 'cooling' || t.state === 'ready' || t.hl,
    faint: t.faint, editing: props.editing,
});
const down = (e: PointerEvent) => { if (props.editing) emit('tile-down', props.tile.key, e); };
</script>

<template>
  <div
    class="ov-tile" :class="cls(tile)" :data-tile-key="tile.key"
    :style="tile.faint ? { opacity: dim / 100 } : undefined"
    @pointerdown="down"
  >
    <div class="ov-ico" :style="{ width: px + 'px', height: px + 'px' }">
      <img :src="src(tile)" alt="" draggable="false">
      <span
        v-if="tile.state === 'cooling' && tile.mask > 0" class="ov-sweep"
        :style="{ background: `conic-gradient(rgba(0,0,0,.7) ${tile.mask * 360}deg, transparent 0)` }"
      />
      <span v-if="tile.sec" class="ov-sec">{{ tile.sec }}</span>
    </div>
    <span v-if="label" class="ov-lbl" :style="{ maxWidth: px + 4 + 'px' }">{{ label }}</span>
  </div>
</template>

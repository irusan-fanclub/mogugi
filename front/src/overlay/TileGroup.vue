<script setup lang="ts">
import { computed } from 'vue';
import type { TileVM } from '@/lib/overlayTiles';
import { ccIconUrl } from '@/lib/util';

const props = defineProps<{
    tiles: TileVM[]; px: number; dim: number; editing: boolean;
    lifted: string | null; insertAt: number | null;
}>();
const emit = defineEmits<{ 'tile-down': [key: string, e: PointerEvent] }>();

type Entry = { bar: true } | { bar: false; tile: TileVM };

// The bar goes before the first tile of the key at insertAt (keys counted in order), or at the end.
const entries = computed<Entry[]>(() => {
    const out: Entry[] = [];
    const seen = new Set<string>();
    let placed = props.insertAt === null;
    for (const t of props.tiles) {
        if (t.key === props.lifted) continue;
        if (!seen.has(t.key)) {
            if (!placed && seen.size === props.insertAt) { out.push({ bar: true }); placed = true; }
            seen.add(t.key);
        }
        out.push({ bar: false, tile: t });
    }
    if (!placed) out.push({ bar: true });
    return out;
});

const src = (t: TileVM) => t.icon.kind === 'skill' ? `/icons/skill/${t.icon.id}.png` : ccIconUrl('', t.icon.id);
// warn / safe / gone only light up with the highlight option; ready and cooling are always styled.
const cls = (t: TileVM) => ({
    [t.state]: t.state === 'ok' || t.state === 'cooling' || t.state === 'ready' || t.hl,
    faint: t.faint, editing: props.editing,
});
const down = (t: TileVM, e: PointerEvent) => { if (props.editing) emit('tile-down', t.key, e); };
</script>

<template>
  <div class="ov-tiles">
    <template v-for="(en, i) in entries" :key="en.bar ? 'bar' : i">
      <div v-if="en.bar" class="ov-ins" />
      <div
        v-else class="ov-tile" :class="cls(en.tile)" :data-tile-key="en.tile.key"
        :style="en.tile.faint ? { opacity: dim / 100 } : undefined"
        @pointerdown="down(en.tile, $event)"
      >
        <div class="ov-ico" :style="{ width: px + 'px', height: px + 'px' }">
          <img :src="src(en.tile)" alt="" draggable="false">
          <span
            v-if="en.tile.state === 'cooling' && en.tile.mask > 0" class="ov-sweep"
            :style="{ background: `conic-gradient(rgba(0,0,0,.7) ${en.tile.mask * 360}deg, transparent 0)` }"
          />
          <span v-if="en.tile.sec" class="ov-sec">{{ en.tile.sec }}</span>
        </div>
        <span v-if="en.tile.label" class="ov-lbl" :style="{ maxWidth: px + 4 + 'px' }">{{ en.tile.label }}</span>
      </div>
    </template>
  </div>
</template>

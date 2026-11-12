<script setup lang="ts">
import { computed } from 'vue';
import type { TileVM } from '@/lib/overlayTiles';
import Tile from './Tile.vue';

const props = defineProps<{
    tiles: TileVM[]; px: number; dim: number; editing: boolean;
    lifted: string | string[] | null; insertAt: number | null;
}>();
const emit = defineEmits<{ 'tile-down': [key: string, e: PointerEvent] }>();

type Entry = { bar: true } | { bar: false; tile: TileVM };

// The bar goes before the first tile of the key at insertAt (keys counted in order), or at the end.
const liftedKeys = computed(() => (Array.isArray(props.lifted) ? props.lifted : props.lifted === null ? [] : [props.lifted]));
const entries = computed<Entry[]>(() => {
    const out: Entry[] = [];
    const seen = new Set<string>();
    let placed = props.insertAt === null;
    for (const t of props.tiles) {
        if (liftedKeys.value.includes(t.key)) continue;
        if (!seen.has(t.key)) {
            if (!placed && seen.size === props.insertAt) { out.push({ bar: true }); placed = true; }
            seen.add(t.key);
        }
        out.push({ bar: false, tile: t });
    }
    if (!placed) out.push({ bar: true });
    return out;
});

const down = (key: string, e: PointerEvent) => emit('tile-down', key, e);
</script>

<template>
  <div class="ov-tiles">
    <template v-for="(en, i) in entries" :key="en.bar ? 'bar' : i">
      <div v-if="en.bar" class="ov-ins" />
      <Tile
        v-else :tile="en.tile" :px="px" :dim="dim" :editing="editing" :label="en.tile.label"
        @tile-down="down"
      />
    </template>
  </div>
</template>

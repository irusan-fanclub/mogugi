<script setup lang="ts">
import { ref, watch } from 'vue';
import type { BoardCell } from '@/lib/equipBoard';
import DTooltip from '../../ui/DTooltip.vue';
import ItemTip from '../../ui/ItemTip.vue';

// One worn-gear cell; weapon cells show the I/II set toggle (display only).
const props = defineProps<{ cell: BoardCell; side?: boolean }>();
defineEmits<{ 'select-set': [v: 0 | 1] }>();
const SETS = ['I', 'II'];

// Most items have no icon upstream; drop a failed one instead of an empty frame.
const noIcon = ref(false);
watch(() => props.cell.entry?.item.id, () => { noIcon.value = false; });
</script>

<template>
  <div class="slot" :class="{ empty: cell.empty, tall: cell.tall, side }" data-slot :data-pocket="cell.pocket">
    <DTooltip bare class="fill">
      <div class="inner">
        <div class="lbl">
          <span>{{ cell.label }}</span>
          <span v-if="cell.set !== undefined" class="sets">
            <button
              v-for="(v, i) in SETS"
              :key="v"
              type="button"
              class="set"
              :class="{ on: cell.set === i }"
              data-set
              @click.stop="$emit('select-set', i as 0 | 1)"
            >{{ v }}</button>
          </span>
        </div>
        <template v-if="cell.entry">
          <img
            v-if="!noIcon"
            class="ico"
            width="48"
            height="48"
            alt=""
            :src="`/icons/item/${cell.entry.item.id}.png`"
            @error="noIcon = true"
          >
          <div class="name" :title="cell.entry.name">{{ cell.entry.name }}</div>
          <div class="brief">{{ cell.entry.brief }}</div>
        </template>
        <div v-else class="none">無</div>
      </div>
      <template v-if="cell.entry?.tip" #content>
        <ItemTip :tip="cell.entry.tip" :title="cell.entry.name" />
      </template>
    </DTooltip>
  </div>
</template>

<style scoped>
.slot {
    width: 128px;
    min-height: 120px;
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-surface);
    cursor: help;
}
.slot.tall { min-height: 200px; }
.slot.empty { opacity: 0.5; cursor: default; }
.fill { display: block; height: 100%; }
.inner { padding: var(--space-3); height: 100%; box-sizing: border-box; }
.lbl { display: flex; justify-content: space-between; font-size: var(--fs-sm); color: var(--c-text-dim); }
.sets { display: inline-flex; gap: var(--space-1); }
.set {
    padding: 0 5px;
    border: 1px solid var(--c-line);
    border-radius: 2px;
    background: transparent;
    color: var(--c-text-dim);
    font: inherit;
    line-height: 1.2;
    cursor: pointer;
}
.set.on { color: var(--c-tip-section-text); border-color: var(--c-tip-section-text); background: var(--c-tip-section-bg); }
.ico { display: block; margin: var(--space-2) auto; object-fit: contain; }
.name {
    margin-top: var(--space-2);
    font-size: var(--fs-md);
    text-align: center;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow-wrap: anywhere;
}
.brief { font-size: var(--fs-xs); color: var(--c-tip-blue); text-align: center; }
.none { text-align: center; color: var(--c-text-dim); padding-top: 24px; }

/* Side cells are squares (side set by the board); the icon is dropped to fit. */
.slot.side {
    width: var(--eq-side);
    height: var(--eq-side);
    min-height: 0;
    overflow: hidden;
}
.side .inner { display: flex; flex-direction: column; }
.side .ico { display: none; }
.side .name { margin-top: auto; }
.side .brief { margin-bottom: auto; }
.side .none { margin: auto 0; padding-top: 0; }
</style>

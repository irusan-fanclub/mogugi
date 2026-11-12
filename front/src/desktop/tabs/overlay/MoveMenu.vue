<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import type { ComponentId } from '@/lib/overlayProtocol';
import type { MoveTo } from './sectionLayout';

// The 「移動 ▾」 button of an item row and its menu.
defineProps<{ blocks: { id: ComponentId; name: string }[]; current: ComponentId; canUp: boolean; canDown: boolean; canNew: boolean }>();
const emit = defineEmits<{ move: [to: MoveTo] }>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const away = (e: Event) => { if (!root.value?.contains(e.target as Node)) open.value = false; };
watch(open, o => {
    if (o) document.addEventListener('pointerdown', away, true);
    else document.removeEventListener('pointerdown', away, true);
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', away, true));
function pick(to: MoveTo) { open.value = false; emit('move', to); }
</script>

<template>
  <span ref="root" class="mv" @click.stop>
    <button type="button" class="mvb" data-move @click="open = !open">移動 ▾</button>
    <div v-if="open" class="mvm" data-move-menu>
      <button type="button" data-move-up :disabled="!canUp" @click="pick({ step: -1 })">往前</button>
      <button type="button" data-move-down :disabled="!canDown" @click="pick({ step: 1 })">往後</button>
      <hr>
      <button
        v-for="b in blocks" :key="b.id" type="button" :data-move-to="b.id" :disabled="b.id === current"
        @click="pick({ frame: b.id })"
      >{{ b.id === current ? `${b.name}（目前）` : b.name }}</button>
      <hr>
      <button type="button" data-move-new :disabled="!canNew" @click="pick('new')">＋ 新的框</button>
    </div>
  </span>
</template>

<style scoped>
.mv { position: relative; }
.mvb {
  padding: 0 8px; border: 1px solid var(--c-line); border-radius: 4px; background: transparent;
  color: var(--c-text-dim); font: inherit; font-size: var(--fs-xs); cursor: pointer;
}
.mvb:hover { color: var(--c-text); border-color: var(--c-text-dim); }
.mvm {
  position: absolute; right: 0; top: 24px; z-index: 5; min-width: 150px; padding: 4px 0;
  background: var(--c-surface-2); border: 1px solid var(--c-line); border-radius: 6px;
  box-shadow: 0 6px 16px rgba(0, 0, 0, .5);
}
.mvm button {
  display: block; width: 100%; padding: 4px 12px; border: 0; background: none; text-align: left;
  color: var(--c-text); font: inherit; font-size: var(--fs-sm); white-space: nowrap; cursor: pointer;
}
.mvm button:hover:not(:disabled) { background: var(--c-line); }
.mvm button:disabled { color: var(--c-text-dim); opacity: .5; cursor: default; }
.mvm hr { border: 0; border-top: 1px solid var(--c-line); margin: 4px 0; }
</style>

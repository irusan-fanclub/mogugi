<script setup lang="ts">
import { DEFAULT_BG } from '@/lib/overlaySettings';

const model = defineModel<string>({ required: true });
const SWATCHES = [DEFAULT_BG, '#1c2740', '#2a1d3d', '#3d1c1c', '#1c3a2b', '#ffffff'];
</script>

<template>
  <span class="bg-field" data-bg-field>
    <button
      v-for="c in SWATCHES" :key="c" type="button" class="sw" :class="{ on: model === c }"
      :style="{ background: c }" :title="c" :aria-label="'底色 ' + c" @click="model = c"
    />
    <label class="custom" :class="{ on: !SWATCHES.includes(model) }" title="自訂顏色">
      <i class="mdi mdi-eyedropper-variant" />
      <input v-model="model" type="color" aria-label="自訂底色">
    </label>
  </span>
</template>

<style scoped>
.bg-field { display: inline-flex; align-items: center; gap: var(--space-2); }
.sw { width: 20px; height: 20px; padding: 0; border: 1px solid var(--c-line); border-radius: 4px; cursor: pointer; }
.sw.on { outline: 2px solid var(--c-accent); outline-offset: 1px; }
.custom { position: relative; display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 22px; border: 1px solid var(--c-line); border-radius: 4px; color: var(--c-text-dim); cursor: pointer; }
.custom.on { outline: 2px solid var(--c-accent); outline-offset: 1px; }
.custom input { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
</style>

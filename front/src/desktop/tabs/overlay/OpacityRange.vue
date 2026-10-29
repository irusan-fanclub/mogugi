<script setup lang="ts">
defineOptions({ inheritAttrs: false });
const model = defineModel<number>({ required: true });
</script>

<template>
  <span class="opacity-range">
    <input v-bind="$attrs" v-model.number="model" type="range" min="0" max="100" step="1" aria-label="透明度">
    <span class="val">{{ model }}%</span>
  </span>
</template>

<style scoped>
.opacity-range { display: inline-flex; align-items: center; gap: var(--space-3); }
input { width: 160px; accent-color: var(--c-accent); }
.val { width: 3em; text-align: right; color: var(--c-text-dim); font-size: var(--fs-sm); }
</style>

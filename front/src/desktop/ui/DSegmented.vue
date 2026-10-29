<script setup lang="ts" generic="T extends string | number">
defineProps<{ options: { value: T; label: string }[]; disabled?: boolean }>();
const model = defineModel<T>({ required: true });

function pick(v: T) {
    if (v !== model.value) model.value = v;
}
</script>

<template>
  <div class="d-segmented" role="radiogroup">
    <button
      v-for="o in options"
      :key="String(o.value)"
      type="button"
      role="radio"
      class="seg"
      :class="{ on: o.value === model }"
      :aria-checked="o.value === model"
      :disabled="disabled"
      @click="pick(o.value)"
    >
      {{ o.label }}
    </button>
  </div>
</template>

<style scoped>
.d-segmented {
    display: inline-flex;
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    overflow: hidden;
}
.seg {
    height: calc(var(--row-h) - 2px);
    padding: 0 var(--space-4);
    border: 0;
    border-right: 1px solid var(--c-line);
    background: var(--c-bg-deep);
    color: var(--c-text-dim);
    font: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
}
.seg:last-child { border-right: 0; }
.seg:hover:not(.on) { color: var(--c-text); }
.seg:focus-visible { outline: 1px solid var(--c-accent); outline-offset: -1px; }
.seg:disabled { opacity: 0.45; cursor: default; }
.seg.on { background: var(--c-accent); color: var(--c-bg-deep); }
</style>

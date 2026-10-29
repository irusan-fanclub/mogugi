<script setup lang="ts">
const model = defineModel<boolean>({ default: false });
defineProps<{ label?: string; indeterminate?: boolean; disabled?: boolean }>();
</script>

<template>
  <button
    type="button"
    role="checkbox"
    class="d-checkbox"
    :aria-checked="indeterminate ? 'mixed' : model"
    :disabled="disabled"
    @click="model = indeterminate ? true : !model"
  >
    <span class="box">
      <i v-if="indeterminate" class="mdi mdi-minus" />
      <i v-else-if="model" class="mdi mdi-check" />
    </span>
    <span v-if="label || $slots.default" class="label"><slot>{{ label }}</slot></span>
  </button>
</template>

<style scoped>
.d-checkbox {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--row-h);
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--c-text);
    font: inherit;
    font-size: var(--fs-md);
    cursor: pointer;
}
.d-checkbox:disabled { opacity: 0.45; cursor: default; }
.d-checkbox:focus-visible .box { outline: 1px solid var(--c-accent); outline-offset: 1px; }
.box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 14px;
    height: 14px;
    border: 1px solid var(--c-text-dim);
    border-radius: var(--radius);
    background: var(--c-bg-deep);
    color: var(--c-bg-deep);
    font-size: var(--fs-sm);
}
.box i { line-height: 1; }
.d-checkbox[aria-checked="true"] .box,
.d-checkbox[aria-checked="mixed"] .box {
    background: var(--c-accent);
    border-color: var(--c-accent);
}
</style>

<script setup lang="ts">
const model = defineModel<boolean>({ default: false });
defineProps<{ label?: string; disabled?: boolean }>();
</script>

<template>
  <button
    type="button"
    role="switch"
    class="d-switch"
    :aria-checked="model"
    :disabled="disabled"
    @click="model = !model"
  >
    <span class="track"><span class="thumb" /></span>
    <span v-if="label || $slots.default" class="label"><slot>{{ label }}</slot></span>
  </button>
</template>

<style scoped>
.d-switch {
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
.d-switch:disabled { opacity: 0.45; cursor: default; }
.d-switch:focus-visible .track { outline: 1px solid var(--c-accent); outline-offset: 1px; }
.track {
    position: relative;
    width: 28px;
    height: 14px;
    border: 1px solid var(--c-line);
    border-radius: 7px;
    background: var(--c-bg-deep);
    transition: background 0.12s;
}
.thumb {
    position: absolute;
    top: 1px;
    left: 1px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--c-text-dim);
    transition: transform 0.12s, background 0.12s;
}
.d-switch[aria-checked="true"] .track { background: var(--c-accent); border-color: var(--c-accent); }
.d-switch[aria-checked="true"] .thumb { transform: translateX(14px); background: var(--c-bg-deep); }
</style>

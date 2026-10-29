<script setup lang="ts">
import DTooltip from './DTooltip.vue';

defineProps<{
    icon: string; // mdi class, e.g. "mdi-close"
    title: string;
    active?: boolean;
    disabled?: boolean;
}>();
</script>

<template>
  <DTooltip :text="title" placement="bottom">
    <button
      type="button"
      class="d-icon-btn"
      :class="{ active }"
      :aria-label="title"
      :disabled="disabled"
    >
      <i class="mdi" :class="icon" />
    </button>
  </DTooltip>
</template>

<style scoped>
.d-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--row-h);
    height: var(--row-h);
    padding: 0;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--c-text-dim);
    font-size: var(--fs-lg);
    cursor: pointer;
}
.d-icon-btn:hover:not(:disabled) { background: var(--c-surface-2); color: var(--c-text); }
.d-icon-btn:focus-visible { outline: 1px solid var(--c-accent); }
.d-icon-btn.active { color: var(--c-accent); }
.d-icon-btn:disabled { opacity: 0.45; cursor: default; }
.d-icon-btn i { line-height: 1; }
</style>

<script setup lang="ts">
import DSpinner from './DSpinner.vue';

withDefaults(defineProps<{
    variant?: 'plain' | 'primary' | 'danger';
    size?: 'sm' | 'md';
    loading?: boolean;
    disabled?: boolean;
    /** Toggle look: accent border and text. */
    active?: boolean;
}>(), { variant: 'plain', size: 'md', active: undefined });
</script>

<template>
  <button
    type="button"
    class="d-btn"
    :class="[`v-${variant}`, `s-${size}`, { loading, active }]"
    :aria-pressed="active === undefined ? undefined : active"
    :disabled="disabled || loading"
  >
    <DSpinner v-if="loading" :size="12" />
    <slot />
  </button>
</template>

<style scoped>
.d-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    height: var(--row-h);
    padding: 0 var(--space-4);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-surface-2);
    color: var(--c-text);
    font: inherit;
    font-size: var(--fs-md);
    cursor: pointer;
    white-space: nowrap;
}
.d-btn.s-sm {
    height: 22px;
    padding: 0 var(--space-3);
    font-size: var(--fs-sm);
}
.d-btn:hover:not(:disabled) { border-color: var(--c-text-dim); }
.d-btn:focus-visible { outline: 1px solid var(--c-accent); outline-offset: 1px; }
.d-btn:disabled { opacity: 0.45; cursor: default; }
.d-btn.active { border-color: var(--c-accent); color: var(--c-accent); }
.d-btn.v-primary {
    background: var(--c-accent);
    border-color: var(--c-accent);
    color: var(--c-bg-deep);
}
.d-btn.v-danger {
    border-color: var(--c-err);
    color: var(--c-err);
    background: transparent;
}
</style>

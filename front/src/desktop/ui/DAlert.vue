<script setup lang="ts">
withDefaults(defineProps<{
    kind?: 'info' | 'warn' | 'error' | 'ok';
    closable?: boolean;
}>(), { kind: 'info' });
defineEmits<{ close: [] }>();

const icons = {
    info: 'mdi-information-outline',
    warn: 'mdi-alert-outline',
    error: 'mdi-alert-circle-outline',
    ok: 'mdi-check-circle-outline',
};
</script>

<template>
  <div class="d-alert" :class="`k-${kind}`" role="alert">
    <i class="mdi icon" :class="icons[kind]" />
    <div class="body"><slot /></div>
    <button
      v-if="closable"
      type="button"
      class="close"
      data-close
      aria-label="close"
      @click="$emit('close')"
    >
      <i class="mdi mdi-close" />
    </button>
  </div>
</template>

<style scoped>
.d-alert {
    --k: var(--c-text-dim);
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--k);
    border-left-width: 3px;
    border-radius: var(--radius);
    background: color-mix(in srgb, var(--k) 12%, var(--c-bg-deep));
    font-size: var(--fs-sm);
}
.k-info { --k: var(--c-share); }
.k-warn { --k: var(--c-warn); }
.k-error { --k: var(--c-err); }
.k-ok { --k: var(--c-ok); }
.icon { color: var(--k); font-size: var(--fs-lg); line-height: 1; }
.body { flex: 1; min-width: 0; color: var(--c-text); }
.close {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--c-text-dim);
    cursor: pointer;
}
.close:hover { color: var(--c-text); }
</style>

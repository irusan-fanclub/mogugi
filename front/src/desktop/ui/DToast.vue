<script setup lang="ts">
import { useToast } from './useToast';

const { items } = useToast();
</script>

<template>
  <Teleport to="body">
    <div class="d-toasts" aria-live="polite">
      <div v-for="t in items" :key="t.id" class="d-toast">{{ t.text }}</div>
    </div>
  </Teleport>
</template>

<style>
.d-toasts {
    position: fixed;
    right: var(--space-5);
    bottom: var(--space-5);
    z-index: 4000;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: flex-end;
    pointer-events: none;
}
.d-toast {
    max-width: 320px;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-surface-2);
    color: var(--c-text);
    font-size: var(--fs-sm);
}
</style>

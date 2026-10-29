<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 16 });
</script>

<template>
  <span
    class="d-spinner"
    role="progressbar"
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
</template>

<style scoped>
.d-spinner {
    display: inline-block;
    border: 2px solid var(--c-line);
    border-top-color: var(--c-accent);
    border-radius: 50%;
    animation: d-spin 0.8s linear infinite;
}
@keyframes d-spin { to { transform: rotate(360deg); } }
</style>

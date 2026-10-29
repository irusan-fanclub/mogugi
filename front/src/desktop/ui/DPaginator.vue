<script setup lang="ts">
import { computed } from 'vue';

const page = defineModel<number>('page', { default: 1 });
const props = withDefaults(defineProps<{ pageCount: number; visible?: number }>(), { visible: 7 });

// Page numbers with '…' gaps, keeping first and last and at most `visible` slots.
const items = computed<(number | '…')[]>(() => {
    const n = props.pageCount;
    const v = Math.max(5, props.visible);
    const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
    if (n <= v) return range(1, n);
    const p = page.value;
    if (p <= v - 3) return [...range(1, v - 2), '…', n];
    if (p >= n - (v - 4)) return [1, '…', ...range(n - (v - 3), n)];
    const half = Math.floor((v - 5) / 2);
    return [1, '…', ...range(p - half, p - half + v - 5), '…', n];
});

const go = (p: number) => { page.value = Math.max(1, Math.min(props.pageCount, p)); };
</script>

<template>
  <nav v-if="pageCount > 1" class="d-pager" aria-label="pagination">
    <button type="button" class="pg" data-prev :disabled="page <= 1" aria-label="上一頁" @click="go(page - 1)">
      <i class="mdi mdi-chevron-left" />
    </button>
    <template v-for="(it, i) in items" :key="i">
      <span v-if="it === '…'" class="gap">…</span>
      <button v-else type="button" class="pg" :class="{ cur: it === page }" data-page :aria-current="it === page ? 'page' : undefined" @click="go(it)">{{ it }}</button>
    </template>
    <button type="button" class="pg" data-next :disabled="page >= pageCount" aria-label="下一頁" @click="go(page + 1)">
      <i class="mdi mdi-chevron-right" />
    </button>
  </nav>
</template>

<style scoped>
.d-pager { display: flex; align-items: center; justify-content: center; gap: var(--space-2); }
.pg {
    min-width: var(--row-h);
    height: var(--row-h);
    padding: 0 var(--space-3);
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--c-text);
    font: inherit;
    font-size: var(--fs-md);
    cursor: pointer;
}
.pg:hover:not(:disabled) { background: var(--c-surface-2); }
.pg:disabled { opacity: 0.4; cursor: default; }
.pg.cur { background: var(--c-accent); color: var(--c-bg-deep); }
.gap { color: var(--c-text-dim); padding: 0 var(--space-2); }
</style>

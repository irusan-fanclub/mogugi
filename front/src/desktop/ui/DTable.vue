<script lang="ts">
export interface TableColumn {
    key: string;
    title: string;
    align?: 'left' | 'right';
    sortable?: boolean;
    width?: string;
}
export interface SortSpec { key: string; order: 'asc' | 'desc' }
</script>

<script setup lang="ts" generic="T extends Record<string, any>">
import { computed } from 'vue';

const props = defineProps<{
    columns: TableColumn[];
    rows: T[];
    sortBy?: SortSpec[];
    /** Property name or function giving a row's unique key. */
    rowKey: string | ((row: T) => string);
    expandedKeys?: string[];
    /** Multi-key sort: plain click cycles one key asc > desc > off; Shift+click stacks keys. */
    multiSort?: boolean;
}>();
const emit = defineEmits<{
    'update:sortBy': [value: SortSpec[]];
    'row-contextmenu': [row: T, e: MouseEvent];
}>();

const keyOf = (row: T) => (typeof props.rowKey === 'function' ? props.rowKey(row) : String(row[props.rowKey]));
const expanded = computed(() => new Set(props.expandedKeys ?? []));
const orderOf = (key: string) => props.sortBy?.find(s => s.key === key)?.order;

// Single mode: first click sorts desc, the next flips.
// multiSort: asc > desc > off; Shift+click keeps the other keys, a plain click replaces them.
function onSort(col: TableColumn, e?: { shiftKey?: boolean }) {
    if (!col.sortable) return;
    if (!props.multiSort) {
        const cur = props.sortBy?.[0];
        const order = cur?.key === col.key && cur.order === 'desc' ? 'asc' : 'desc';
        emit('update:sortBy', [{ key: col.key, order }]);
        return;
    }
    const cur = props.sortBy ?? [];
    const prev = cur.find(s => s.key === col.key)?.order;
    const next = prev === undefined ? 'asc' : prev === 'asc' ? 'desc' : undefined;
    const others = e?.shiftKey ? cur.filter(s => s.key !== col.key) : [];
    if (!next) { emit('update:sortBy', others); return; }
    const spec: SortSpec = { key: col.key, order: next };
    // Keep a stacked key's position when it only flips direction.
    emit('update:sortBy', e?.shiftKey
        ? cur.some(s => s.key === col.key) ? cur.map(s => (s.key === col.key ? spec : s)) : [...others, spec]
        : [spec]);
}
const rank = (key: string) => (props.multiSort && (props.sortBy?.length ?? 0) > 1
    ? (props.sortBy!.findIndex(s => s.key === key) + 1 || '') : '');
const mark = (key: string) => (orderOf(key) === 'desc' ? '▼' : orderOf(key) === 'asc' ? '▲' : '');
</script>

<template>
  <table class="d-table">
    <thead>
      <tr>
        <th
          v-for="c in columns"
          :key="c.key"
          :class="{ sortable: c.sortable, right: c.align === 'right' }"
          :style="c.width ? { width: c.width } : undefined"
          :data-col="c.key"
          :tabindex="c.sortable ? 0 : undefined"
          :aria-sort="orderOf(c.key) === 'desc' ? 'descending' : orderOf(c.key) === 'asc' ? 'ascending' : undefined"
          @click="onSort(c, $event)"
          @keydown.enter.prevent="onSort(c, $event)"
          @keydown.space.prevent="onSort(c, $event)"
        >{{ c.title }}<span v-if="c.sortable" class="mark">{{ mark(c.key) }}<sub v-if="rank(c.key)" class="rank">{{ rank(c.key) }}</sub></span></th>
      </tr>
    </thead>
    <tbody>
      <template v-for="row in rows" :key="keyOf(row)">
        <tr class="row" data-row @contextmenu="emit('row-contextmenu', row, $event)">
          <td v-for="c in columns" :key="c.key" :class="{ right: c.align === 'right' }" :data-cell="c.key">
            <slot :name="`cell-${c.key}`" :row="row">{{ row[c.key] }}</slot>
          </td>
        </tr>
        <tr v-if="expanded.has(keyOf(row)) && $slots.expanded" class="expanded" data-expanded>
          <td :colspan="columns.length"><slot name="expanded" :row="row" /></td>
        </tr>
      </template>
    </tbody>
  </table>
</template>

<style scoped>
.d-table { width: 100%; border-collapse: collapse; font-size: var(--fs-md); }
th {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: var(--space-3) var(--space-4);
    background: var(--c-bg);
    border-bottom: 1px solid var(--c-line);
    color: var(--c-text-dim);
    font-size: var(--fs-sm);
    font-weight: normal;
    text-align: left;
    white-space: nowrap;
    user-select: none;
}
th.sortable { cursor: pointer; }
th.sortable:hover { color: var(--c-text); }
th.right, td.right { text-align: right; }
.mark { margin-left: var(--space-2); color: var(--c-accent); }
.rank { font-size: var(--fs-sm); }
th.sortable:focus-visible { outline: 1px solid var(--c-accent); outline-offset: -1px; }
td { padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--c-line); vertical-align: middle; }
.row:hover td { background: var(--c-surface); }
.expanded td { background: var(--c-surface); }
</style>

<script lang="ts">
export interface MultiItem { value: string | number; title: string }
</script>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import DMenu from './DMenu.vue';

const model = defineModel<(string | number)[]>({ default: () => [] });
const props = defineProps<{
    items: MultiItem[];
    /** Selection cap; 1 makes it a single-pick (a new pick replaces). */
    max?: number;
    placeholder?: string;
    clearable?: boolean;
    /** Rows rendered at most (default 300); the rest are reached by typing. */
    limit?: number;
    /** Custom search match; default is a case-insensitive title substring. */
    filter?: (item: MultiItem, query: string) => boolean;
}>();
const emit = defineEmits<{
    /** Enter pressed with no highlighted match; carries the typed text. */
    submit: [text: string];
}>();

const open = ref(false);
const query = ref('');
const hi = ref(-1);

const chips = computed(() =>
    model.value.map(v => ({ value: v, title: props.items.find(i => i.value === v)?.title ?? String(v) })));
const matched = computed(() => {
    const q = query.value.trim().toLowerCase();
    if (!q) return props.items;
    const f = props.filter ?? ((i: MultiItem, s: string) => i.title.toLowerCase().includes(s));
    return props.items.filter(i => f(i, q));
});
const cap = computed(() => props.limit ?? 300);
const shown = computed(() => matched.value.slice(0, cap.value));
const overflow = computed(() => Math.max(0, matched.value.length - cap.value));
watch(query, () => { hi.value = shown.value.length ? 0 : -1; });
watch(open, v => { if (!v) { query.value = ''; hi.value = -1; } });

function pick(item: MultiItem) {
    if (props.max === 1) {
        model.value = [item.value];
        open.value = false;
        query.value = '';
        return;
    }
    if (model.value.includes(item.value)) model.value = model.value.filter(v => v !== item.value);
    else if (props.max === undefined || model.value.length < props.max) model.value = [...model.value, item.value];
}
function remove(v: string | number) { model.value = model.value.filter(x => x !== v); }

function onKey(e: KeyboardEvent) {
    const n = shown.value.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!open.value) { open.value = true; return; }
        if (n) hi.value = e.key === 'ArrowDown' ? (hi.value + 1) % n : (hi.value - 1 + n) % n;
    } else if (e.key === 'Enter') {
        e.preventDefault();
        const q = query.value.trim();
        // An exact id wins over the highlight; an unknown pure number is submitted as a typed id.
        const exact = q ? props.items.find(i => String(i.value) === q) : undefined;
        if (exact) pick(exact);
        else if (/^\d+$/.test(q)) { emit('submit', query.value); query.value = ''; }
        else if (open.value && hi.value >= 0 && shown.value[hi.value]) pick(shown.value[hi.value]);
        else if (q) { emit('submit', query.value); query.value = ''; }
    } else if (e.key === 'Backspace' && query.value === '' && model.value.length && props.max !== 1) {
        model.value = model.value.slice(0, -1);
    }
}
function onInput(e: Event) {
    query.value = (e.target as HTMLInputElement).value;
    open.value = true;
}
</script>

<template>
  <DMenu v-model="open" manual match-width :close-on-content-click="false">
    <template #activator>
      <div class="box" data-multi-box @click="open = true">
        <span v-for="c in chips" :key="c.value" class="chip" data-chip>
          <span class="ctext">{{ c.title }}</span>
          <button type="button" class="x" data-chip-remove aria-label="remove" @click.stop="remove(c.value)">
            <i class="mdi mdi-close" />
          </button>
        </span>
        <input
          class="text"
          type="text"
          spellcheck="false"
          :placeholder="chips.length ? '' : placeholder"
          :value="query"
          @click.stop="open = true"
          @input="onInput"
          @keydown="onKey"
        >
        <button
          v-if="clearable && model.length"
          type="button"
          class="x"
          data-clear
          tabindex="-1"
          aria-label="clear"
          @click.stop="model = []"
        >
          <i class="mdi mdi-close-circle" />
        </button>
      </div>
    </template>
    <div class="list" role="listbox" @mousedown.prevent>
      <div
        v-for="(item, i) in shown"
        :key="item.value"
        class="opt"
        :class="{ hi: i === hi, sel: model.includes(item.value) }"
        role="option"
        :aria-selected="model.includes(item.value)"
        @mouseenter="hi = i"
        @click="pick(item)"
      >
        <i v-if="max !== 1" class="mdi" :class="model.includes(item.value) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline'" />
        <span class="title">{{ item.title }}</span>
      </div>
      <div v-if="overflow > 0" class="empty">還有 {{ overflow }} 筆，請輸入文字縮小範圍</div>
      <div v-if="!shown.length" class="empty">無符合項目</div>
    </div>
  </DMenu>
</template>

<style scoped>
.box {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-width: 0;
    min-height: var(--row-h);
    padding: 2px var(--space-2);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-bg-deep);
    color: var(--c-text);
    font-size: var(--fs-md);
    cursor: text;
}
.box:focus-within { outline: 1px solid var(--c-accent); outline-offset: -1px; }
.chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    max-width: 100%;
    padding: 0 var(--space-2);
    border-radius: var(--radius);
    background: var(--c-surface-2);
    font-size: var(--fs-sm);
}
.ctext { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.x {
    display: inline-flex;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--c-text-dim);
    cursor: pointer;
}
.x:hover { color: var(--c-text); }
.text {
    flex: 1;
    min-width: 60px;
    height: calc(var(--row-h) - 6px);
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: inherit;
    font: inherit;
}
.list { padding: var(--space-1) 0; max-height: 280px; overflow-y: auto; }
.opt { display: flex; align-items: center; gap: var(--space-3); min-height: var(--row-h); padding: 0 var(--space-3); cursor: pointer; }
.opt.hi { background: var(--c-surface-2); }
.opt.sel { color: var(--c-accent); }
.title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { padding: var(--space-3); color: var(--c-text-dim); }
</style>

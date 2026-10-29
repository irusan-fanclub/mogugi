<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import DMenu from './DMenu.vue';

/** `short` is shown in the closed box instead of `title`. */
export interface SelectItem { value: string; title: string; short?: string }

const model = defineModel<string>({ default: '' });
const props = defineProps<{
    items: SelectItem[];
    clearable?: boolean;
    searchable?: boolean;
    /** Search box at the top of the open menu; the closed box stays plain. */
    menuSearch?: boolean;
    /** Free text is accepted as a value (Enter or blur). */
    allowCustom?: boolean;
    placeholder?: string;
}>();

const open = ref(false);
const query = ref('');
const hi = ref(-1);
const searchEl = ref<HTMLInputElement>();
const boxEl = ref<HTMLElement>();
const inputMode = computed(() => !!props.searchable || !!props.allowCustom);

const selectedTitle = computed(() => {
    const it = props.items.find(i => i.value === model.value);
    if (it) return it.short ?? it.title;
    return props.allowCustom ? model.value : '';
});

// While typing show the query; otherwise the selected title.
const inputValue = computed(() =>
    query.value !== '' ? query.value : (open.value && props.searchable ? '' : selectedTitle.value));

const shown = computed(() => {
    const q = query.value.trim().toLowerCase();
    if (!(props.searchable || props.menuSearch) || !q) return props.items;
    return props.items.filter(i => i.title.toLowerCase().includes(q));
});

function openMenu() {
    if (open.value) return;
    open.value = true;
    hi.value = Math.max(0, shown.value.findIndex(i => i.value === model.value));
}

watch(open, v => {
    if (!v) { query.value = ''; hi.value = -1; }
    else if (props.menuSearch) nextTick(() => searchEl.value?.focus());
});
watch(query, () => { hi.value = shown.value.length ? 0 : -1; });

function pick(item: SelectItem) {
    model.value = item.value;
    open.value = false;
    // The focused search input is gone with the menu; keep keyboard users on the box.
    if (props.menuSearch) nextTick(() => boxEl.value?.focus());
}

function commitCustom() {
    const v = query.value.trim();
    if (props.allowCustom && v && v !== model.value) model.value = v;
}

function onRowClick(e: MouseEvent, item: SelectItem) {
    // Action buttons rendered by the item slot must not select or close.
    if ((e.target as HTMLElement).closest('button, [data-no-select]')) return;
    pick(item);
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && props.menuSearch && open.value) {
        e.stopPropagation();
        if (query.value) query.value = '';
        else open.value = false;
        return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!open.value) { openMenu(); return; }
        const n = shown.value.length;
        if (!n) return;
        hi.value = e.key === 'ArrowDown' ? (hi.value + 1) % n : (hi.value - 1 + n) % n;
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (props.menuSearch && open.value) {
            if (hi.value >= 0 && shown.value[hi.value]) pick(shown.value[hi.value]);
            return;
        }
        if (open.value && hi.value >= 0 && shown.value[hi.value] && !(props.allowCustom && query.value.trim() && !props.searchable)) {
            pick(shown.value[hi.value]);
        } else if (props.allowCustom) {
            commitCustom();
            open.value = false;
        } else if (!open.value) {
            openMenu();
        }
    }
}

function onInput(e: Event) {
    query.value = (e.target as HTMLInputElement).value;
    if (!open.value && props.searchable) openMenu();
}

function onBlur() {
    if (props.allowCustom && query.value.trim()) commitCustom();
    if (props.allowCustom) query.value = '';
}
</script>

<template>
  <DMenu v-model="open" manual match-width :self-escape="menuSearch" :close-on-content-click="false">
    <template #activator>
      <div
        ref="boxEl"
        class="box"
        data-select-box
        role="combobox"
        aria-haspopup="listbox"
        :aria-expanded="open"
        :tabindex="inputMode ? undefined : 0"
        @click="open ? (open = false) : openMenu()"
        @keydown="onKey"
      >
        <input
          v-if="inputMode"
          class="text"
          type="text"
          spellcheck="false"
          :placeholder="placeholder"
          :value="inputValue"
          @click.stop="openMenu"
          @input="onInput"
          @blur="onBlur"
        >
        <span v-else class="text" :class="{ ph: !selectedTitle }">{{ selectedTitle || placeholder || '' }}</span>
        <button
          v-if="clearable && model"
          type="button"
          class="clear"
          data-clear
          tabindex="-1"
          aria-label="clear"
          @click.stop="model = ''"
        >
          <i class="mdi mdi-close" />
        </button>
        <i class="mdi mdi-menu-down caret" />
      </div>
    </template>
    <div v-if="menuSearch" class="search">
      <input
        ref="searchEl"
        v-model="query"
        class="search-in"
        data-menu-search
        type="text"
        spellcheck="false"
        placeholder="搜尋"
        @keydown="onKey"
      >
      <span class="count" data-menu-count>{{ shown.length }} / {{ items.length }}</span>
      <slot name="search-extra" />
    </div>
    <div class="list" role="listbox" @mousedown.prevent>
      <div
        v-for="(item, i) in shown"
        :key="item.value"
        class="opt"
        :class="{ hi: i === hi, sel: item.value === model }"
        role="option"
        :aria-selected="item.value === model"
        @mouseenter="hi = i"
        @click="onRowClick($event, item)"
      >
        <slot name="item" :item="item" :selected="item.value === model" :query="query">
          <span class="title">{{ item.title }}</span>
        </slot>
      </div>
      <div v-if="!shown.length" class="empty">無符合項目</div>
      <div v-if="$slots.footer" class="foot"><slot name="footer" /></div>
    </div>
  </DMenu>
</template>

<style scoped>
.box {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-width: 0;
    height: var(--row-h);
    padding: 0 var(--space-2) 0 var(--space-3);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-bg-deep);
    color: var(--c-text);
    font-size: var(--fs-md);
    cursor: pointer;
}
.box:focus-visible, .box:focus-within { outline: 1px solid var(--c-accent); outline-offset: -1px; }
.text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
input.text {
    height: 100%;
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: inherit;
    font: inherit;
}
.ph { color: var(--c-text-dim); }
.clear {
    display: inline-flex;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--c-text-dim);
    cursor: pointer;
}
.clear:hover { color: var(--c-text); }
.caret { color: var(--c-text-dim); line-height: 1; }
.search {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--c-line);
}
.search-in {
    flex: 1;
    min-width: 0;
    height: var(--row-h);
    padding: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--c-text);
    font: inherit;
}
.count { color: var(--c-text-dim); font-size: var(--fs-sm); white-space: nowrap; }
.list { padding: var(--space-1) 0; }
.opt {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--row-h);
    padding: 0 var(--space-3);
    cursor: pointer;
}
.opt.hi { background: var(--c-surface-2); }
.opt.sel { color: var(--c-accent); }
.opt .title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { padding: var(--space-3); color: var(--c-text-dim); }
.foot { border-top: 1px solid var(--c-line); }
</style>

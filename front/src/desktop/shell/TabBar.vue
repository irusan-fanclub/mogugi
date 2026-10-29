<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { fitTabs } from './tabFit';

interface TabItem { id: string; label: string }
interface PinnedItem extends TabItem { icon: string }

const props = defineProps<{ tabs: TabItem[]; pinned: PinnedItem[] }>();
const model = defineModel<string>();

const MORE_W = 36;

const root = ref<HTMLElement>();
const ghost = ref<HTMLElement>();
const pinnedEl = ref<HTMLElement>();
const menuOpen = ref(false);
const visibleIdx = ref<number[]>(props.tabs.map((_, i) => i));

const allIds = computed(() => [...props.tabs.map(t => t.id), ...props.pinned.map(t => t.id)]);

if (model.value === undefined) model.value = props.tabs[0]?.id ?? '';

const visible = computed(() => visibleIdx.value.map(i => props.tabs[i]).filter(Boolean));
const hidden = computed(() => props.tabs.filter((_, i) => !visibleIdx.value.includes(i)));

function measure() {
    const el = root.value;
    if (!el || !ghost.value) return;
    const widths = Array.from(ghost.value.children).map(c => (c as HTMLElement).offsetWidth);
    const pinned = pinnedEl.value?.offsetWidth ?? 0;
    const selected = props.tabs.findIndex(t => t.id === model.value);
    visibleIdx.value = fitTabs(widths, el.clientWidth, pinned, MORE_W, selected);
}

let ro: ResizeObserver | undefined;
function onDocDown(e: Event) {
    if (menuOpen.value && !(e.target as HTMLElement | null)?.closest?.('[data-more-wrap]')) menuOpen.value = false;
}

onMounted(() => {
    measure();
    if (typeof ResizeObserver !== 'undefined' && root.value) {
        ro = new ResizeObserver(() => measure());
        ro.observe(root.value);
    }
    document.addEventListener('pointerdown', onDocDown);
});
onBeforeUnmount(() => {
    ro?.disconnect();
    document.removeEventListener('pointerdown', onDocDown);
});
watch([() => props.tabs, model], () => nextTick(measure), { deep: true });

function pick(id: string) {
    model.value = id;
    menuOpen.value = false;
}
</script>

<template>
  <div ref="root" class="tabbar">
    <div class="tabs" role="tablist">
      <button
        v-for="t in visible"
        :key="t.id"
        type="button"
        role="tab"
        class="tab"
        :class="{ on: model === t.id }"
        :aria-selected="model === t.id"
        :data-tab="t.id"
        @click="pick(t.id)"
      >
        {{ t.label }}
      </button>
      <div v-if="hidden.length" class="more-wrap" data-more-wrap>
        <button
          type="button"
          class="tab more"
          data-more
          aria-label="更多分頁"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          <i class="mdi mdi-dots-horizontal" />
        </button>
        <div v-if="menuOpen" class="menu" role="menu">
          <button
            v-for="t in hidden"
            :key="t.id"
            type="button"
            role="menuitem"
            class="menu-item"
            :data-menu-tab="t.id"
            @click="pick(t.id)"
          >
            {{ t.label }}
          </button>
        </div>
      </div>
    </div>
    <div ref="pinnedEl" class="pinned">
      <button
        v-for="p in pinned"
        :key="p.id"
        type="button"
        role="tab"
        class="tab settings"
        :class="{ on: model === p.id }"
        :aria-selected="model === p.id"
        :aria-label="p.label"
        :title="p.label"
        :data-tab="p.id"
        @click="pick(p.id)"
      >
        <i class="mdi" :class="p.icon" />
      </button>
    </div>
    <div ref="ghost" class="ghost" aria-hidden="true">
      <span v-for="t in tabs" :key="t.id" class="tab">{{ t.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.tabbar {
    position: relative;
    display: flex;
    align-items: stretch;
    height: 30px;
    border-bottom: 1px solid var(--c-line);
    background: var(--c-bg-deep);
}
.tabs { display: flex; flex: 1; min-width: 0; }
.tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 var(--space-5);
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: var(--c-text-dim);
    font: inherit;
    font-size: var(--fs-md);
    white-space: nowrap;
    cursor: pointer;
}
.tab:hover { color: var(--c-text); background: var(--c-surface); }
.tab:focus-visible { outline: 1px solid var(--c-accent); outline-offset: -2px; }
.tab.on { color: var(--c-text); border-bottom-color: var(--c-accent); }
.more { width: 36px; padding: 0; }
.pinned { display: flex; }
.settings { padding: 0 var(--space-4); font-size: var(--fs-lg); }
.more-wrap { position: relative; }
.menu {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 100;
    min-width: 120px;
    padding: var(--space-2) 0;
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-surface-2);
}
.menu-item {
    display: block;
    width: 100%;
    padding: var(--space-3) var(--space-5);
    border: 0;
    background: transparent;
    color: var(--c-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.menu-item:hover { background: var(--c-surface); }
.ghost {
    position: absolute;
    left: 0;
    top: 0;
    display: flex;
    visibility: hidden;
    pointer-events: none;
    height: 0;
    overflow: hidden;
}
</style>

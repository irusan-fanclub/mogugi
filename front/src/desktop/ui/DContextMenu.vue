<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useContextMenu, type MenuItem } from './useContextMenu';

const { state, close } = useContextMenu();
const el = ref<HTMLElement>();
const pos = ref({ left: 0, top: 0, ready: false });
const maxH = () => `${Math.max(0, window.innerHeight - 2 * EDGE)}px`;
const hi = ref(-1);
const EDGE = 4;

const isItem = (it: MenuItem): it is Exclude<MenuItem, 'divider'> => it !== 'divider';
const enabled = (i: number) => {
    const it = state.items[i];
    return isItem(it) && !it.disabled;
};

// Clamp into the window once the real size is known.
async function place() {
    pos.value = { left: state.x, top: state.y, ready: false };
    await nextTick();
    const r = el.value?.getBoundingClientRect();
    const w = r?.width ?? 0;
    const h = r?.height ?? 0;
    pos.value = {
        left: Math.max(EDGE, Math.min(state.x, window.innerWidth - w - EDGE)),
        top: Math.max(EDGE, Math.min(state.y, window.innerHeight - h - EDGE)),
        ready: true,
    };
}

watch(() => [state.open, state.x, state.y, state.items] as const, ([o]) => {
    if (!o) return;
    hi.value = -1;
    place();
});

// Keyboard navigation must keep the highlighted item visible in a scrolling menu.
watch(hi, async i => {
    if (i < 0) return;
    await nextTick();
    el.value?.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView?.({ block: 'nearest' });
});

function run(i: number) {
    const it = state.items[i];
    if (!isItem(it) || it.disabled) return;
    close();
    it.action();
}

function step(dir: 1 | -1) {
    const n = state.items.length;
    for (let k = 1; k <= n; k++) {
        const i = (((hi.value === -1 ? (dir === 1 ? -1 : 0) : hi.value) + dir * k) % n + n) % n;
        if (enabled(i)) { hi.value = i; return; }
    }
}

function onKey(e: KeyboardEvent) {
    if (!state.open) return;
    if (e.key === 'Escape') {
        e.stopPropagation();
        close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        step(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter' && hi.value >= 0) {
        e.preventDefault();
        run(hi.value);
    }
}

function onPointerDown(e: Event) {
    if (state.open && !el.value?.contains(e.target as Node)) close();
}

onMounted(() => {
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
});
onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('resize', close);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.open"
      ref="el"
      class="d-ctx"
      role="menu"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px`, visibility: pos.ready ? 'visible' : 'hidden', maxHeight: maxH() }"
      @contextmenu.prevent
    >
      <template v-for="(it, i) in state.items" :key="i">
        <div v-if="it === 'divider'" class="sep" role="separator" />
        <div
          v-else
          class="item"
          :class="{ hi: i === hi && !it.disabled, danger: it.danger, disabled: it.disabled }"
          role="menuitem"
          :data-i="i"
          :aria-disabled="it.disabled ? 'true' : undefined"
          @mouseenter="hi = it.disabled ? -1 : i"
          @click="run(i)"
        >
          <i v-if="it.icon" class="mdi" :class="it.icon" />
          <span class="label">{{ it.label }}</span>
        </div>
      </template>
    </div>
  </Teleport>
</template>

<style>
.d-ctx {
    position: fixed;
    z-index: 4000;
    min-width: 140px;
    padding: var(--space-1) 0;
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-surface);
    color: var(--c-text);
    font-size: var(--fs-md);
    overflow-y: auto;
}
.d-ctx .item {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--row-h);
    padding: 0 var(--space-4) 0 var(--space-3);
    cursor: pointer;
    white-space: nowrap;
}
.d-ctx .item.hi { background: var(--c-surface-2); }
.d-ctx .item.danger { color: var(--c-err); }
.d-ctx .item.disabled { color: var(--c-text-dim); opacity: 0.6; cursor: default; }
.d-ctx .item i { line-height: 1; }
.d-ctx .sep { height: 1px; margin: var(--space-1) 0; background: var(--c-line); }
</style>

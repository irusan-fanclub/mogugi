<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref } from 'vue';

const props = withDefaults(defineProps<{
    text?: string;
    delay?: number;
    placement?: 'right' | 'bottom' | 'top';
    /** Drop the default panel chrome; the content slot brings its own (ItemTip). */
    bare?: boolean;
}>(), { delay: 150, placement: 'bottom' });

const GAP = 6;
const activator = ref<HTMLElement>();
const tip = ref<HTMLElement>();
const open = ref(false);
const pos = ref({ left: 0, top: 0 });
let timer: ReturnType<typeof setTimeout> | undefined;

async function place() {
    await nextTick();
    if (!activator.value || !tip.value) return;
    const a = activator.value.getBoundingClientRect();
    const t = tip.value.getBoundingClientRect();
    let left: number;
    let top: number;
    if (props.placement === 'right') {
        left = a.right + GAP;
        top = a.top + (a.height - t.height) / 2;
    } else if (props.placement === 'top') {
        left = a.left + (a.width - t.width) / 2;
        top = a.top - t.height - GAP;
    } else {
        left = a.left + (a.width - t.width) / 2;
        top = a.bottom + GAP;
    }
    // Keep the tooltip inside the viewport.
    left = Math.max(GAP, Math.min(left, window.innerWidth - t.width - GAP));
    top = Math.max(GAP, Math.min(top, window.innerHeight - t.height - GAP));
    pos.value = { left, top };
}

function show() {
    clearTimeout(timer);
    timer = setTimeout(() => {
        open.value = true;
        place();
    }, props.delay);
}

function hide() {
    clearTimeout(timer);
    open.value = false;
}

onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <span
    ref="activator"
    class="d-tip-activator"
    @mouseenter="show"
    @mouseleave="hide"
    @focusin="show"
    @focusout="hide"
    @mousedown="hide"
  >
    <slot />
    <Teleport to="body">
      <div
        v-if="open && (text || $slots.content)"
        ref="tip"
        class="d-tip"
        :class="{ 'd-tip-bare': bare }"
        role="tooltip"
        :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
      >
        <slot name="content">{{ text }}</slot>
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.d-tip-activator { display: inline-flex; }
</style>

<style>
.d-tip {
    position: fixed;
    z-index: 3000;
    max-width: 320px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-surface-2);
    color: var(--c-text);
    font-size: var(--fs-sm);
    pointer-events: none;
    white-space: pre-wrap;
}
.d-tip.d-tip-bare {
    max-width: none;
    padding: 0;
    border: 0;
    background: none;
}
</style>

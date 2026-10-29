<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

// Popover anchored under its activator. `manual` leaves toggling to the parent.
const model = defineModel<boolean>({ default: false });
const props = withDefaults(defineProps<{
    closeOnContentClick?: boolean;
    matchWidth?: boolean;
    manual?: boolean;
    /** The content handles Esc itself (e.g. clears a search first). */
    selfEscape?: boolean;
}>(), { closeOnContentClick: true });

const GAP = 2;
const EDGE = 4;
const act = ref<HTMLElement>();
const pop = ref<HTMLElement>();
const pos = ref({ left: 0, top: 0, minWidth: 0 });

async function place() {
    await nextTick();
    if (!act.value || !pop.value) return;
    const a = act.value.getBoundingClientRect();
    const p = pop.value.getBoundingClientRect();
    let left = a.left;
    let top = a.bottom + GAP;
    // Flip above the activator when there is no room below.
    if (top + p.height > window.innerHeight - EDGE) top = Math.max(EDGE, a.top - p.height - GAP);
    left = Math.max(EDGE, Math.min(left, window.innerWidth - p.width - EDGE));
    pos.value = { left, top, minWidth: props.matchWidth ? a.width : 0 };
}

function onActivatorClick() {
    if (!props.manual) model.value = !model.value;
}

function onPointerDown(e: Event) {
    if (!model.value) return;
    const t = e.target as Node | null;
    if (t && (act.value?.contains(t) || pop.value?.contains(t))) return;
    model.value = false;
}

// Capture phase: Esc closes the menu before a dialog underneath sees it.
function onKey(e: KeyboardEvent) {
    if (model.value && !props.selfEscape && e.key === 'Escape') {
        e.stopPropagation();
        model.value = false;
    }
}

function onContentClick() {
    if (props.closeOnContentClick) model.value = false;
}

watch(model, v => { if (v) place(); });
onMounted(() => {
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', place);
    if (model.value) place();
});
onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', place);
});
defineExpose({ place });
</script>

<template>
  <span class="d-menu">
  <span ref="act" class="d-menu-act" @click="onActivatorClick">
    <slot name="activator" :open="model" />
  </span>
  <Teleport to="body">
    <div
      v-if="model"
      ref="pop"
      class="d-menu-pop"
      :style="{ left: `${pos.left}px`, top: `${pos.top}px`, minWidth: pos.minWidth ? `${pos.minWidth}px` : undefined }"
      @click="onContentClick"
    >
      <slot />
    </div>
  </Teleport>
  </span>
</template>

<style scoped>
.d-menu { display: inline-flex; min-width: 0; }
.d-menu-act { display: inline-flex; flex: 1; min-width: 0; }
</style>

<style>
.d-menu-pop {
    position: fixed;
    z-index: 2500;
    max-height: min(320px, calc(100vh - 8px));
    overflow: auto;
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-surface);
    color: var(--c-text);
    font-size: var(--fs-md);
}
</style>

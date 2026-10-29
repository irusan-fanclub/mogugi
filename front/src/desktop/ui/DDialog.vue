<script lang="ts">
// Open dialogs, oldest first; only the last one reacts to Esc and Tab.
const stack: symbol[] = [];
let uid = 0;
</script>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const model = defineModel<boolean>({ default: false });
withDefaults(defineProps<{ title?: string; width?: number | string; fill?: boolean }>(), { width: 420 });

const me = Symbol('dialog');
const titleId = `d-dialog-title-${++uid}`;
const dialogEl = ref<HTMLElement>();
let prevFocus: HTMLElement | null = null;

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

function isTop() {
    return stack[stack.length - 1] === me;
}

function onKey(e: KeyboardEvent) {
    if (!model.value || !isTop()) return;
    if (e.key === 'Escape') {
        model.value = false;
    } else if (e.key === 'Tab' && dialogEl.value) {
        const els = Array.from(dialogEl.value.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (els.length === 0) {
            e.preventDefault();
            dialogEl.value.focus();
            return;
        }
        const first = els[0];
        const last = els[els.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === dialogEl.value)) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
        }
    }
}

function opened() {
    prevFocus = document.activeElement as HTMLElement | null;
    stack.push(me);
    nextTick(() => {
        const el = dialogEl.value;
        if (!el) return;
        (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    });
}

function closed() {
    const i = stack.indexOf(me);
    if (i >= 0) stack.splice(i, 1);
    prevFocus?.focus?.();
    prevFocus = null;
}

watch(model, v => (v ? opened() : closed()));
onMounted(() => {
    document.addEventListener('keydown', onKey);
    if (model.value) opened();
});
onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKey);
    if (stack.includes(me)) closed();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="model" class="d-scrim" data-scrim @click.self="model = false">
      <div
        ref="dialogEl"
        class="d-dialog"
        :class="{ fill }"
        role="dialog"
        aria-modal="true"
        tabindex="-1"
        :aria-labelledby="title || $slots.title ? titleId : undefined"
        :style="{ width: typeof width === 'number' ? `${width}px` : width }"
      >
        <header v-if="title || $slots.title" :id="titleId" class="head">
          <slot name="title">{{ title }}</slot>
        </header>
        <div class="body"><slot /></div>
        <footer v-if="$slots.actions" class="foot"><slot name="actions" /></footer>
      </div>
    </div>
  </Teleport>
</template>

<style>
.d-scrim {
    position: fixed;
    inset: 0;
    z-index: 2000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--c-bg-deep) 70%, transparent);
}
.d-dialog {
    outline: 0;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-surface);
    color: var(--c-text);
}
/* fill: take the full available height so the body can distribute it to its content. */
.d-dialog.fill { height: calc(100vh - 32px); }
.d-dialog.fill .body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.d-dialog .head {
    padding: var(--space-4) var(--space-5);
    border-bottom: 1px solid var(--c-line);
    font-size: var(--fs-lg);
}
.d-dialog .body {
    padding: var(--space-5);
    overflow: auto;
    font-size: var(--fs-md);
}
.d-dialog .foot {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-5);
    border-top: 1px solid var(--c-line);
}
</style>

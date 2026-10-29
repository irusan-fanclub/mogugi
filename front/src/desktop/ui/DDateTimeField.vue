<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';

// Value is a datetime-local string ('' when empty); callers convert with
// toLocalRFC3339 when filtering. Blurred it shows the date only.
const model = defineModel<string>({ default: '' });
defineProps<{ label?: string; placeholder?: string }>();

const focused = ref(false);
const input = ref<HTMLInputElement>();
const shown = computed(() => (focused.value ? model.value : model.value.slice(0, 10)));

function onInput(e: Event) { model.value = (e.target as HTMLInputElement).value; }

async function openPicker() {
    focused.value = true;
    await nextTick();
    input.value?.focus();
    // showPicker is gesture-gated; focus already allows typing.
    try { (input.value as HTMLInputElement & { showPicker?: () => void }).showPicker?.(); } catch { /* ignore */ }
}
</script>

<template>
  <div class="d-dt" :class="{ focused }">
    <input
      ref="input"
      :type="focused ? 'datetime-local' : 'text'"
      :value="shown"
      :aria-label="label"
      :placeholder="placeholder ?? label"
      :readonly="!focused ? true : undefined"
      @focus="focused = true"
      @blur="focused = false"
      @input="onInput"
    >
    <button v-if="model" type="button" class="btn" data-clear tabindex="-1" aria-label="clear" @click="model = ''">
      <i class="mdi mdi-close" />
    </button>
    <button type="button" class="btn" data-calendar tabindex="-1" aria-label="日曆" @mousedown.prevent @click="openPicker">
      <i class="mdi mdi-calendar" />
    </button>
  </div>
</template>

<style scoped>
.d-dt {
    display: flex;
    align-items: center;
    width: 130px;
    height: var(--row-h);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-bg-deep);
}
.d-dt.focused { width: 210px; border-color: var(--c-accent); }
input {
    flex: 1;
    min-width: 0;
    height: 100%;
    padding: 0 var(--space-3);
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--c-text);
    font: inherit;
    font-size: var(--fs-md);
    color-scheme: dark;
}
input::placeholder { color: var(--c-text-dim); }
/* Our own calendar button replaces the native indicator. */
input::-webkit-calendar-picker-indicator { display: none; }
.btn {
    display: inline-flex;
    align-items: center;
    padding: 0 var(--space-2);
    border: 0;
    background: transparent;
    color: var(--c-text-dim);
    cursor: pointer;
}
.btn:hover { color: var(--c-text); }
</style>

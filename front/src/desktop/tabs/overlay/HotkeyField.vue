<script setup lang="ts">
import { ref } from 'vue';
import { keyEventToHotkey } from '@/lib/hotkey';

defineProps<{ hotkey: string }>();
const emit = defineEmits<{ setHotkey: [hotkey: string] }>();

const listening = ref(false);
const error = ref('');
const MODIFIERS = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph'];

function start() {
    listening.value = true;
    error.value = '';
}
// Leaving the field drops any half-entered combo and its message.
function stop() {
    listening.value = false;
    error.value = '';
}
function onKeydown(e: KeyboardEvent) {
    if (!listening.value) return;
    // A bare Tab is navigation, never a hotkey; let focus move on.
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) { stop(); return; }
    e.preventDefault();
    if (e.key === 'Escape') { stop(); return; }
    if (MODIFIERS.includes(e.key)) return;
    const hk = keyEventToHotkey(e);
    if (!hk) { error.value = '需包含 Ctrl 或 Alt，加上英數字或 F1–F12'; return; }
    error.value = '';
    stop();
    emit('setHotkey', hk);
}
</script>

<template>
  <span class="hotkey-field">
    <button type="button" class="key" :class="{ listening }" @click="start" @keydown="onKeydown" @blur="stop">
      {{ listening ? '請按下新的組合鍵…' : hotkey }}
    </button>
    <span v-if="error" class="err" data-hotkey-invalid>{{ error }}</span>
  </span>
</template>

<style scoped>
.hotkey-field { display: inline-flex; align-items: center; gap: var(--space-3); }
.key {
    height: calc(var(--row-h) - 2px);
    padding: 0 var(--space-4);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-bg-deep);
    color: var(--c-text);
    font: inherit;
    font-size: var(--fs-sm);
    cursor: pointer;
}
.key:hover { border-color: var(--c-accent); }
.key.listening { border-color: var(--c-accent); color: var(--c-accent); }
.err { color: var(--c-err); font-size: var(--fs-xs); }
</style>

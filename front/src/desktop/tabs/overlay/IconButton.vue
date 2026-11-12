<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';

// 'move' only forwards the click (its owner opens a menu); 'remove' needs a second click within ARM_MS; 'reset' fires at once.
const props = defineProps<{ kind: 'reset' | 'remove' | 'move' }>();
const emit = defineEmits<{ fire: [] }>();

const ARM_MS = 3000;
const armed = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

const disarm = () => { armed.value = false; clearTimeout(timer); timer = undefined; };
function click() {
    if (props.kind !== 'remove') { emit('fire'); return; }
    if (armed.value) { disarm(); emit('fire'); return; }
    armed.value = true;
    timer = setTimeout(disarm, ARM_MS);
}
const title = computed(() => props.kind === 'reset' ? '重設' : props.kind === 'move' ? '移動' : armed.value ? '再點一次移除' : '移除');
const ICON = { reset: 'mdi-restore', remove: 'mdi-delete', move: 'mdi-arrow-all' } as const;
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <button
    type="button" class="ibtn" :class="{ armed }" :title="title" :aria-label="title"
    :data-armed="armed ? '' : undefined" @click.stop="click"
  >
    <i class="mdi" :class="ICON[kind]" />
  </button>
</template>

<style scoped>
.ibtn { width: 24px; height: 24px; flex: none; padding: 0; border: 1px solid var(--c-line); border-radius: var(--radius); background: var(--c-surface-2); color: var(--c-text-dim); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; font-size: 14px; }
.ibtn:hover { color: var(--c-text); }
.ibtn i { line-height: 1; }
.ibtn.armed { background: var(--c-err); border-color: var(--c-err); color: #fff; }
</style>

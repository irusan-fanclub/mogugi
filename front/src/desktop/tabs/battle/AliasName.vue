<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { randomAlias, setAlias } from '@/lib/entityAlias';

// Name with inline alias editing. Everything here stops clicks so the
// surrounding row does not expand.
const props = withDefaults(defineProps<{
    realName: string;
    displayName: string;
    /** The roster on screen, so a re-roll avoids someone's real name. */
    knownRealNames?: string[];
    /** Fixed name width (CSS length); unset keeps the content-sized layout. */
    nameWidth?: string;
}>(), { knownRealNames: () => [], nameWidth: undefined });
const editing = defineModel<boolean>('editing', { default: false });

// Name column truncates instead of wrapping or widening the row.
const NAME_STYLE = { minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;
const nameStyle = computed(() => props.nameWidth ? { ...NAME_STYLE, width: props.nameWidth, flex: 'none' } : NAME_STYLE);

const draft = ref('');
const input = ref<HTMLInputElement>();

watch(editing, async v => {
    if (!v) return;
    draft.value = props.displayName;
    await nextTick();
    input.value?.focus();
    input.value?.select();
});

// Reached from Enter, blur and the check button; the guard stops a double commit.
function commit() {
    if (!editing.value) return;
    editing.value = false;
    setAlias(props.realName, draft.value);
}
function cancel() {
    editing.value = false;
}
</script>

<template>
  <span class="alias" @click.stop @pointerdown.stop>
    <template v-if="editing">
      <input
        ref="input"
        v-model="draft"
        class="field"
        spellcheck="false"
        aria-label="別名"
        @keydown.enter.prevent="commit"
        @keydown.esc.stop.prevent="cancel"
        @blur="commit"
      >
      <!-- mousedown is swallowed so the field keeps focus until the click lands. -->
      <button type="button" class="ib" title="套用" aria-label="套用" @mousedown.prevent @click="commit">
        <i class="mdi mdi-check" />
      </button>
    </template>
    <template v-else>
      <span class="pname" :style="nameStyle" :title="displayName">{{ displayName }}</span>
      <button type="button" class="ib" title="改名" aria-label="改名" data-shot-hide @click="editing = true">
        <i class="mdi mdi-pencil" />
      </button>
      <button type="button" class="ib" title="隨機別名" aria-label="隨機別名" data-shot-hide @click="randomAlias(realName, [...knownRealNames])">
        <i class="mdi mdi-dice-5" />
      </button>
    </template>
  </span>
</template>

<style scoped>
.alias { display: flex; align-items: center; gap: var(--space-1); flex: 0 1 auto; min-width: 0; }
.alias:has(.field) { flex: 1; }
.pname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.field {
    flex: 1;
    min-width: 0;
    height: calc(var(--row-h) - 6px);
    padding: 0 var(--space-3);
    border: 1px solid var(--c-accent);
    border-radius: var(--radius);
    background: var(--c-bg-deep);
    color: var(--c-text);
    font: inherit;
    outline: 0;
}
.ib {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: var(--radius);
    background: transparent;
    color: var(--c-text-dim);
    font-size: var(--fs-md);
    cursor: pointer;
}
.ib:hover { background: var(--c-surface-2); color: var(--c-text); }
.ib i { line-height: 1; }
</style>

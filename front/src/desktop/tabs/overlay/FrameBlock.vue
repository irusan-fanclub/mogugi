<script setup lang="ts">
import IconButton from './IconButton.vue';

// One frame of a section: its name, a collapsible 外觀 part and (optionally) its item list.
defineProps<{ title: string; summary: string; open: boolean }>();
const emit = defineEmits<{ toggle: []; reset: [] }>();
</script>

<template>
  <div class="ovs-box ovs-frame" data-frame-block>
    <h3 class="fname" data-frame-title>{{ title }}</h3>
    <div class="fsub">
      <div class="fhead" data-frame-look-toggle @click="emit('toggle')">
        <span class="caret">{{ open ? '▾' : '▸' }}</span><span class="flabel">外觀</span>
        <span class="ovs-dim fsum" data-frame-summary>{{ summary }}</span>
        <IconButton kind="reset" data-frame-reset @fire="emit('reset')" />
      </div>
      <div v-if="open" class="fbody"><slot name="look" /></div>
    </div>
    <div v-if="$slots.items" class="fsub">
      <div class="fhead plain"><span class="flabel">監測項目</span></div>
      <slot name="items" />
    </div>
  </div>
</template>

<style scoped>
.fname { margin: 0 0 var(--space-3); font-size: var(--fs-sm); font-weight: 700; color: var(--c-text); }
.fsub { margin: 0 0 var(--space-3); }
.fhead { display: flex; align-items: center; gap: var(--space-3); min-height: 24px; margin-bottom: var(--space-2); font-size: var(--fs-sm); color: var(--c-text-dim); cursor: pointer; }
.fhead.plain { cursor: default; }
.flabel { font-size: var(--fs-sm); color: var(--c-text-dim); }
.fsum { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fhead .ibtn { margin-left: auto; }
.caret { width: 10px; font-size: var(--fs-xs); }
.fbody { padding: 2px 0 2px var(--space-4); }
</style>

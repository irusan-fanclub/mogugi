<script setup lang="ts">
import type { PanelBg } from '@/lib/overlaySections';
import DSegmented from '../../ui/DSegmented.vue';

// null follows the 通用 panel colour; 自訂 starts from `fallback`.
const props = defineProps<{ fallback: PanelBg }>();
const model = defineModel<PanelBg | null>({ required: true });

const OPTIONS = [{ value: 'follow', label: '跟隨通用' }, { value: 'own', label: '自訂' }] as const;
const mode = (v: 'follow' | 'own') => { model.value = v === 'own' ? { ...props.fallback } : null; };
const patch = (p: Partial<PanelBg>) => { if (model.value) model.value = { ...model.value, ...p }; };
</script>

<template>
  <div class="ovs-field">
    <span class="ovs-lbl">面板底色</span>
    <DSegmented :model-value="model ? 'own' : 'follow'" :options="[...OPTIONS]" data-bg-mode @update:model-value="mode" />
  </div>
  <div v-if="model" class="ovs-field">
    <span class="ovs-lbl" />
    <input type="color" :value="model.color" data-bg-color @input="e => patch({ color: (e.target as HTMLInputElement).value })">
    <input
      type="range" min="0" max="100" step="5" :value="model.alpha" data-bg-alpha aria-label="透明度"
      @input="e => patch({ alpha: Number((e.target as HTMLInputElement).value) })"
    >
    <span class="ovs-dim">{{ model.alpha }}%</span>
  </div>
</template>

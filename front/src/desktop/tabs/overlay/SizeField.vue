<script setup lang="ts">
import { computed } from 'vue';
import type { SizeChoice } from '@/lib/overlaySections';
import DSegmented from '../../ui/DSegmented.vue';

export interface SizeValue { size: SizeChoice; px: number }
const props = defineProps<{ presets: Record<'s' | 'm' | 'l', number>; min: number; max: number }>();
const model = defineModel<SizeValue>({ required: true });

const OPTIONS: { value: SizeChoice; label: string }[] = [
    { value: 's', label: '小' }, { value: 'm', label: '中' }, { value: 'l', label: '大' }, { value: 'c', label: '自訂' },
];
const current = computed(() => model.value.size === 'c' ? model.value.px : props.presets[model.value.size]);

// 自訂 starts from the size shown now.
const pick = (size: SizeChoice) => { model.value = { size, px: size === 'c' ? current.value : model.value.px }; };
function typed(raw: string) {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || raw.trim() === '') return;
    model.value = { size: 'c', px: Math.min(props.max, Math.max(props.min, n)) };
}
</script>

<template>
  <span class="size-field">
    <DSegmented :model-value="model.size" :options="OPTIONS" @update:model-value="pick" />
    <span class="px">
      <input
        class="ovs-num" type="number" :min="min" :max="max" :value="current"
        :disabled="model.size !== 'c'" data-size-px
        @change="e => typed((e.target as HTMLInputElement).value)"
      > px
    </span>
  </span>
</template>

<style scoped>
.size-field { display: inline-flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.px { white-space: nowrap; }
</style>

<script setup lang="ts">
import { computed } from 'vue';
import { region } from '@/store';
import { ccIconUrl } from '@/lib/util';
import { BREAK_BOX, boxValueText } from '@/lib/ccParamSpecs';
import type { CcValueSummary } from '@/lib/ccValues';
import DTooltip from '../../ui/DTooltip.vue';
import CcTip from './CcTip.vue';

// 「破防保最高」: each CC's own highest value in the range, never summed across CCs.
const props = defineProps<{ values: Map<number, CcValueSummary> }>();

const items = computed(() => BREAK_BOX.map(b => {
    const text = boxValueText(b, props.values.get(b.ccId)?.values);
    return { id: b.ccId, text, zero: text === '0', dmg: b.ccId === 1166 };
}));
</script>

<template>
  <div class="break-box">
    <div class="t">破防保最高</div>
    <div class="items">
      <DTooltip v-for="it in items" :key="it.id" bare placement="top" class="it" :class="{ zero: it.zero }" :data-break-cc="it.id">
        <img :src="ccIconUrl(region, it.id)" width="18" height="18" alt="" />
        <span class="v" :class="{ dmg: it.dmg && !it.zero }">{{ it.text }}</span>
        <template #content><CcTip :cc-id="it.id" :summary="values.get(it.id)" /></template>
      </DTooltip>
    </div>
  </div>
</template>

<style scoped>
.break-box {
  padding: var(--space-1) var(--space-2);
  /* Plain colours only: html2canvas (the tab screenshot) can't parse color-mix(). */
  border: 1px solid var(--c-line); border-radius: var(--radius);
  background: var(--c-surface);
}
.t { margin-bottom: 2px; font-size: var(--fs-xs); color: var(--c-text-dim); }
.items { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-1) var(--space-4); }
.it { align-items: center; gap: var(--space-1); cursor: default; }
.it img { border-radius: 2px; }
.v { font-family: var(--font-num); font-size: var(--fs-sm); font-weight: 700; color: var(--c-number); font-variant-numeric: tabular-nums; }
.v.dmg { color: var(--c-ok); }
.zero .v { color: var(--c-text-dim); font-weight: 400; }
</style>

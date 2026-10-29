<script setup lang="ts">
import { computed } from 'vue';
import { clearTimeRange, hasTimeRange, timeRangeMax, timeRangeMin } from '@/store';
import { formatMinSec } from '@/lib/util';
import DButton from '../../ui/DButton.vue';

// origin: the fight's first hit, so the range reads like the chart axis.
const props = defineProps<{ origin: number }>();

const clock = (v: number | null) => (v == null ? '' : new Date(v * 1000).toLocaleTimeString());
const text = computed(() => {
    const lo = timeRangeMin.value ?? 0;
    const hi = timeRangeMax.value ?? 0;
    return `${formatMinSec(lo - props.origin)} ~ ${formatMinSec(hi - props.origin)}（${formatMinSec(hi - lo)}）`;
});
</script>

<template>
  <div v-if="hasTimeRange" class="filter-bar" data-time-filter data-html2canvas-ignore>
    <i class="mdi mdi-clock-outline" />
    <span :title="`${clock(timeRangeMin)} ~ ${clock(timeRangeMax)}`">時間篩選：{{ text }}</span>
    <span class="grow" />
    <DButton size="sm" data-clear-filter @click="clearTimeRange()">取消篩選</DButton>
  </div>
</template>

<style scoped>
.filter-bar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-surface);
    color: var(--c-warn);
    font-size: var(--fs-sm);
}
.grow { flex: 1; }
</style>

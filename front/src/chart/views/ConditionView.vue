<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { ChartData, ChartOpts, ChartSpec } from '@/lib/chartProtocol';
import { formatDuration } from '@/lib/util';
import type { ConditionPayload } from '@/desktop/windows/conditionPayload';
import { conditionOption, CONDITION_TOKENS } from '@/desktop/charts/conditionOption';
import { readTokens } from '@/desktop/theme/readTokens';
import EChart, { type ZoomRange } from '@/desktop/charts/EChart.vue';
import DSelect from '@/desktop/ui/DSelect.vue';

// spec and opts are part of the view contract (views.ts); the selection lives in the payload.
const props = defineProps<{ spec?: ChartSpec; data: ChartData | null; opts?: ChartOpts; range?: { min: number; max: number } | null }>();
const emit = defineEmits<{
    opts: [patch: Partial<ChartOpts>];
    range: [range: { min: number; max: number } | null];
}>();

const payload = computed(() => props.data?.payload as ConditionPayload | undefined);
const items = computed(() => (payload.value?.options ?? []).map(o => ({ value: String(o.id), title: o.name })));
const selected = computed(() => payload.value?.options.find(o => o.id === payload.value?.ccId));
const onPct = computed(() => {
    const p = payload.value;
    return p && p.total > 0 ? (100 * p.on / p.total).toFixed(1) : '0.0';
});

const tokens = ref<Record<string, string>>({});
onMounted(() => { tokens.value = readTokens(CONDITION_TOKENS); });
const option = computed(() => conditionOption({ series: payload.value?.series ?? [], tokens: tokens.value }));

const chart = ref<InstanceType<typeof EChart>>();
// The main window cleared the global filter: unzoom silently (no chart:range echo).
watch(() => props.range, r => { if (r === null) chart.value?.resetZoom(); });

function onZoom(r: ZoomRange | null) {
    emit('range', r ? { min: r.startMs / 1000, max: r.endMs / 1000 } : null);
}
</script>

<template>
  <div class="cond-view">
    <div class="head">
      <span>CC:</span>
      <img v-if="selected" class="icon" :src="selected.icon" width="16" height="16" alt="">
      <div class="select">
        <DSelect
          :model-value="String(payload?.ccId ?? '')"
          :items="items"
          @update:model-value="v => emit('opts', { ccId: Number(v) })"
        />
      </div>
      <span>Total: {{ formatDuration(payload?.total ?? 0) }}</span>
      <span>ON: {{ formatDuration(payload?.on ?? 0) }} ({{ onPct }}%)</span>
    </div>
    <div class="plot">
      <EChart ref="chart" :option="option" @zoom="onZoom" />
      <div v-if="!payload" class="waiting">等待主視窗…</div>
      <div v-else-if="payload.options.length === 0" class="waiting">沒有可顯示的狀態</div>
    </div>
  </div>
</template>

<style scoped>
.cond-view { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.head { display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-4); padding: var(--space-3); flex-shrink: 0; }
.select { width: 240px; }
.icon { flex-shrink: 0; }
.plot { position: relative; flex: 1; min-height: 0; }
.waiting {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    color: var(--c-text-dim); pointer-events: none;
}
</style>

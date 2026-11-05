<script setup lang="ts">
import { computed } from 'vue';
import { condNameMap, region } from '@/store';
import { ccIconUrl, ccName } from '@/lib/util';
import { ccParamRows } from '@/lib/ccParamSpecs';
import { fmtCoveragePct, type CcValueSummary } from '@/lib/ccValues';

// Body of a battle-tab CC tooltip: wrap in <DTooltip bare> with this in #content.
const props = defineProps<{
    ccId: number;
    /** Highest readings in the selected range; undefined = not seen in it. */
    summary: CcValueSummary | undefined;
    hint?: string;
}>();

const rows = computed(() => (props.summary ? ccParamRows(props.ccId, props.summary.values) : []));
</script>

<template>
  <div class="cc-tip">
    <div class="head">
      <img :src="ccIconUrl(region, ccId)" width="20" height="20" alt="" />
      <span>{{ ccName(condNameMap, ccId) }}</span>
      <span class="id">{{ ccId }}</span>
    </div>
    <template v-if="summary">
      <div class="kv">
        <template v-for="r in rows" :key="r.key">
          <template v-if="r.label !== null">
            <span class="lb">{{ r.label }}</span><span class="n">{{ r.value }}</span><span class="key">{{ r.key }}</span>
          </template>
          <template v-else>
            <span class="raw">{{ r.key }}</span><span class="raw">{{ r.value }}</span><span class="key" />
          </template>
        </template>
        <span class="lb">覆蓋率</span><span class="n">{{ fmtCoveragePct(summary.coveragePct) }}</span><span class="key" />
      </div>
    </template>
    <div v-else class="none">這場沒有觸發</div>
    <div v-if="hint" class="hint">{{ hint }}</div>
  </div>
</template>

<style scoped>
.cc-tip {
  min-width: 200px; max-width: 340px; padding: var(--space-2) var(--space-3);
  border: 1px solid var(--c-line); border-radius: var(--radius);
  background: var(--c-surface-2); color: var(--c-text); font-size: var(--fs-xs);
  box-shadow: 0 4px 12px rgb(0 0 0 / 30%);
}
.head { display: flex; align-items: center; gap: var(--space-2); margin-bottom: var(--space-1); font-size: var(--fs-sm); }
.head img { border-radius: 2px; }
.head .id { color: var(--c-text-dim); font-family: var(--font-num); font-size: var(--fs-xs); }
.kv { display: grid; grid-template-columns: auto auto 1fr; gap: 1px var(--space-3); }
.lb { color: var(--c-text-dim); }
.n { color: var(--c-number); font-family: var(--font-num); }
.raw { color: var(--c-text-dim); font-family: var(--font-num); }
.key { color: var(--c-text-dim); opacity: 0.6; font-family: var(--font-num); font-size: 11px; }
.none, .hint { color: var(--c-text-dim); }
.hint { margin-top: var(--space-1); font-size: 11px; }
</style>

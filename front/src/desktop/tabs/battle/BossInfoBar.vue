<script setup lang="ts">
import { computed } from 'vue';
import type { BossInfoVM } from '@/lib/bossInfo';
import { formatMinSec, formatThousands, humanReadableNumber } from '@/lib/util';

const props = defineProps<{ info: BossInfoVM }>();

const pctText = computed(() => props.info.dead ? 'x_x' : props.info.hpPct === null ? '—' : `${props.info.hpPct.toFixed(1)}%`);
const barPct = computed(() => props.info.dead ? 0 : props.info.hpPct ?? 0);
const elapsed = computed(() => formatMinSec(props.info.fightSec ?? 0));
</script>

<template>
  <div class="boss-info">
    <div class="name" :title="info.name">{{ info.name }}</div>
    <div data-pct class="pct" :class="{ dead: info.dead }">{{ pctText }}</div>
    <div class="hp">
      <div class="bar"><i :style="{ width: barPct + '%' }" /></div>
      <div class="nums">
        <span><b>{{ formatThousands(info.life) }}</b><template v-if="info.maxLife"> / {{ formatThousands(info.maxLife) }}</template></span>
        <span>已造成 {{ formatThousands(info.dealt) }}</span>
      </div>
    </div>
    <div class="stat"><div class="k">經過時間</div><div class="v">{{ elapsed }}</div></div>
    <div class="stat"><div class="k">隊伍 DPS</div><div class="v dps">{{ humanReadableNumber(info.partyDps) }}</div></div>
  </div>
</template>

<style scoped>
.boss-info {
  display: flex; align-items: center; flex-wrap: wrap; gap: var(--space-3) var(--space-4);
  padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--c-line);
}
.name { font-size: var(--fs-lg); font-weight: 700; color: var(--c-text); white-space: nowrap; }
/* Fixed width fits "100.0%" so x_x and the numbers beside it never shift. */
.pct { width: 92px; text-align: center; font-size: 22px; font-weight: 800; color: var(--c-err); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pct.dead { color: var(--c-text-dim); letter-spacing: 1px; }
.hp { flex: 1; min-width: 160px; }
.bar { height: 10px; background: var(--c-surface-2); border-radius: 5px; overflow: hidden; }
.bar i { display: block; height: 100%; background: var(--c-err); }
.nums { display: flex; justify-content: space-between; gap: var(--space-3); margin-top: var(--space-1); font-size: var(--fs-sm); color: var(--c-text-dim); font-variant-numeric: tabular-nums; }
.nums b { color: var(--c-text); font-weight: 600; }
.stat { text-align: right; white-space: nowrap; }
.k { font-size: var(--fs-xs); color: var(--c-text-dim); }
.v { font-size: var(--fs-lg); font-weight: 700; color: var(--c-text); font-variant-numeric: tabular-nums; }
.v.dps { color: var(--c-dps); }
</style>

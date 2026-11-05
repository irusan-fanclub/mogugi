<script setup lang="ts">
import { computed } from 'vue';
import type { DpsOverlayVM } from '@/lib/overlayModel';
import { dpsFontPx, type DpsLook } from '@/lib/overlaySections';
import { formatDuration, humanReadableNumber } from '@/lib/util';

const props = defineProps<{ vm: DpsOverlayVM; look: DpsLook; rowsMax: number }>();

const boss = computed(() => props.vm.boss);
const hasBoss = computed(() => {
    const b = boss.value;
    const t = props.look.top;
    return !!b && (t.boss || (t.hpPct && b.hpPct !== null) || (t.hpLeft && b.life !== null));
});
const showTop = computed(() => {
    const t = props.look.top;
    return hasBoss.value || (t.time && props.vm.fightSec !== null) || t.partyDps;
});
const rows = computed(() => props.vm.rows.slice(0, Math.max(0, props.rowsMax)));
</script>

<template>
  <div class="ov-dps" :style="{ fontSize: dpsFontPx(look) + 'px' }">
    <div v-if="showTop" class="ov-top" data-top>
      <span v-if="hasBoss && boss" data-boss>
        <template v-if="look.top.boss">{{ boss.name }}</template>
        <span v-if="look.top.hpPct && boss.hpPct !== null" class="ov-sec-num"> {{ boss.hpPct.toFixed(1) }}%</span>
        <span v-if="look.top.hpLeft && boss.life !== null" class="ov-sec-num"> {{ humanReadableNumber(boss.life) }}</span>
      </span>
      <span v-if="look.top.time && vm.fightSec !== null" class="ov-sec-num" data-time>{{ formatDuration(vm.fightSec) }}</span>
      <span v-if="look.top.partyDps" data-party>隊伍 <span class="ov-sec-num">{{ humanReadableNumber(vm.partyDps) }}</span></span>
    </div>
    <div v-for="r in rows" :key="r.id" class="ov-row" :class="{ self: r.isSelf }" data-row>
      <span class="ov-name">{{ r.name }}</span>
      <span v-if="look.columns.dps" class="ov-sec-num" data-col="dps">{{ humanReadableNumber(r.dps) }}</span>
      <span v-if="look.columns.total" class="ov-sec-num" data-col="total">{{ humanReadableNumber(r.total) }}</span>
      <span v-if="look.columns.share" class="ov-sec-num" data-col="share">{{ (r.share * 100).toFixed(1) }}%</span>
    </div>
  </div>
</template>

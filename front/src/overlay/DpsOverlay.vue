<script setup lang="ts">
import { computed } from 'vue';
import type { DpsOverlayVM } from '@/lib/overlayModel';
import type { DpsOverlaySettings } from '@/lib/overlaySettings';
import { formatDuration, humanReadableNumber } from '@/lib/util';

const props = defineProps<{ vm: DpsOverlayVM; settings: DpsOverlaySettings }>();

const showTop = computed(() => {
    const t = props.settings.top;
    return (t.boss && props.vm.boss) || (t.time && props.vm.fightSec !== null) || t.partyDps;
});
</script>

<template>
  <div class="ov-dps">
    <div v-if="showTop" class="ov-top" data-top>
      <span v-if="settings.top.boss && vm.boss" data-boss>
        {{ vm.boss.name }}<template v-if="vm.boss.hpPct !== null"> <span class="ov-num">{{ vm.boss.hpPct.toFixed(1) }}%</span></template>
      </span>
      <span v-if="settings.top.time && vm.fightSec !== null" class="ov-num" data-time>{{ formatDuration(vm.fightSec) }}</span>
      <span v-if="settings.top.partyDps" data-party>隊伍 <span class="ov-num">{{ humanReadableNumber(vm.partyDps) }}</span></span>
    </div>
    <div v-for="(r, i) in vm.rows" :key="r.id" class="ov-row" :class="{ self: r.isSelf }" data-row>
      <span class="ov-rank">{{ i + 1 }}.</span>
      <span class="ov-name">{{ r.name }}</span>
      <span v-if="settings.columns.dps" class="ov-num" data-col="dps">{{ humanReadableNumber(r.dps) }}</span>
      <span v-if="settings.columns.total" class="ov-num" data-col="total">{{ humanReadableNumber(r.total) }}</span>
      <span v-if="settings.columns.share" class="ov-num" data-col="share">{{ (r.share * 100).toFixed(1) }}%</span>
    </div>
  </div>
</template>

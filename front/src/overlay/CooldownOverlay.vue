<script setup lang="ts">
import { computed } from 'vue';
import { ICON_PX, type CooldownOverlaySettings } from '@/lib/overlaySettings';
import { SKILL_COOLDOWNS, type CooldownRowVM } from '@/lib/skillCooldown';

const props = defineProps<{ rows: CooldownRowVM[]; settings: CooldownOverlaySettings; maxRows: number }>();

const px = computed(() => ICON_PX[props.settings.iconSize]);
const shown = computed(() => props.rows.slice(0, props.maxRows));

function maskOf(r: CooldownRowVM): string | undefined {
    if (r.remaining <= 0) return undefined;
    const total = SKILL_COOLDOWNS.find(s => s.skillId === r.skillId)?.cooldownSec ?? 0;
    if (total <= 0) return undefined;
    const deg = Math.min(360, r.remaining / total * 360);
    return `conic-gradient(rgba(0,0,0,.7) ${deg}deg, transparent 0)`;
}
</script>

<template>
  <div class="ov-cc">
    <div
      v-for="r in shown" :key="`${r.id}:${r.skillId}`" class="ov-cc-row" :class="{ self: r.isSelf }" data-cd-row
    >
      <span class="ov-name">{{ r.name }}</span>
      <div class="ov-icons">
        <div
          class="ov-icon" :class="{ ready: r.remaining <= 0 }"
          :style="{ width: px + 'px', height: px + 'px' }" data-cd-icon
        >
          <img :src="`/icons/skill/${r.skillId}.png`" alt="" draggable="false">
          <div v-if="maskOf(r)" class="ov-mask" :style="{ background: maskOf(r) }" data-mask />
          <span class="ov-sec">{{ r.remaining > 0 ? Math.ceil(r.remaining) : '好了' }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

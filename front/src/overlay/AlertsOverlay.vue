<script setup lang="ts">
import { computed } from 'vue';
import { FONT_PX, type AlertsOverlaySettings } from '@/lib/overlaySettings';
import type { Anchor } from '@/lib/overlayProtocol';
import type { AlertItem } from './useOverlayData';

const props = defineProps<{ items: AlertItem[]; settings: AlertsOverlaySettings; anchor: Anchor; maxRows: number }>();

// Bottom anchors grow upward: the newest sits at the bottom. Others put the newest on top.
const shown = computed(() => {
    const latest = props.items.slice(-props.maxRows);
    return props.anchor === 'bl' || props.anchor === 'br' ? latest : latest.reverse();
});
</script>

<template>
  <div class="ov-alerts" :style="{ fontSize: FONT_PX[settings.fontSize] + 'px' }">
    <div v-for="a in shown" :key="a.key" class="ov-alert" :class="{ loud: a.loud }" data-alert>{{ a.text }}</div>
  </div>
</template>

<script setup lang="ts">
import { overlaySettings, updateOverlaySettings } from '../../overlay/overlayLink';
import type { CooldownOverlaySettings as Cd, SizeStep } from '@/lib/overlaySettings';
import DSegmented from '../../ui/DSegmented.vue';
import OpacityRange from './OpacityRange.vue';

const SIZES = [
    { value: 's', label: '小' },
    { value: 'm', label: '中' },
    { value: 'l', label: '大' },
] as const;

const set = (mut: (c: Cd) => void) => updateOverlaySettings(s => mut(s.cooldown));
</script>

<template>
  <div class="settings">
    <div class="setting">
      <div class="lbl">
        <div>透明度</div>
        <div class="hint">只影響背景，圖示維持不透明</div>
      </div>
      <OpacityRange
        data-cooldown-opacity
        :model-value="overlaySettings.cooldown.opacity"
        @update:model-value="v => set(c => { c.opacity = v; })"
      />
    </div>
    <div class="setting">
      <div class="lbl">圖示大小</div>
      <DSegmented
        :model-value="overlaySettings.cooldown.iconSize"
        :options="[...SIZES]"
        @update:model-value="(v: SizeStep) => set(c => { c.iconSize = v; })"
      />
    </div>
  </div>
</template>

<style scoped>
.settings { display: flex; flex-direction: column; gap: var(--space-4); }
.setting { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
.hint { color: var(--c-text-dim); font-size: var(--fs-xs); }
</style>

<script setup lang="ts">
import { overlaySettings, updateOverlaySettings } from '../../overlay/overlayLink';
import type { DpsOverlaySettings as Dps, SizeStep } from '@/lib/overlaySettings';
import DSegmented from '../../ui/DSegmented.vue';
import DCheckbox from '../../ui/DCheckbox.vue';
import OpacityRange from './OpacityRange.vue';

const SIZES = [
    { value: 's', label: '小' },
    { value: 'm', label: '中' },
    { value: 'l', label: '大' },
] as const;
const COLUMNS = [
    { key: 'dps', label: 'DPS' },
    { key: 'total', label: '總傷害' },
    { key: 'share', label: '佔比' },
] as const;
const TOP = [
    { key: 'boss', label: 'BOSS' },
    { key: 'time', label: '時間' },
    { key: 'partyDps', label: '隊伍 DPS' },
] as const;

const set = (mut: (d: Dps) => void) => updateOverlaySettings(s => mut(s.dps));
</script>

<template>
  <div class="settings">
    <div class="setting">
      <div class="lbl">
        <div>透明度</div>
        <div class="hint">只影響背景，文字與圖示維持不透明</div>
      </div>
      <OpacityRange
        data-dps-opacity
        :model-value="overlaySettings.dps.opacity"
        @update:model-value="v => set(d => { d.opacity = v; })"
      />
    </div>
    <div class="setting">
      <div class="lbl">字體大小</div>
      <DSegmented
        :model-value="overlaySettings.dps.fontSize"
        :options="[...SIZES]"
        @update:model-value="(v: SizeStep) => set(d => { d.fontSize = v; })"
      />
    </div>
    <div class="group">
      <div class="sub">每列顯示</div>
      <div class="checks">
        <DCheckbox
          v-for="c in COLUMNS"
          :key="c.key"
          :model-value="overlaySettings.dps.columns[c.key]"
          :label="c.label"
          @update:model-value="v => set(d => { d.columns[c.key] = v; })"
        />
      </div>
    </div>
    <div class="group">
      <div class="sub">頂部資訊</div>
      <div class="checks">
        <DCheckbox
          v-for="c in TOP"
          :key="c.key"
          :model-value="overlaySettings.dps.top[c.key]"
          :label="c.label"
          @update:model-value="v => set(d => { d.top[c.key] = v; })"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings { display: flex; flex-direction: column; gap: var(--space-4); }
.setting { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
.hint { color: var(--c-text-dim); font-size: var(--fs-xs); }
.sub { color: var(--c-text-dim); font-size: var(--fs-sm); }
.group { display: flex; flex-direction: column; gap: var(--space-2); }
.checks { display: flex; flex-wrap: wrap; gap: var(--space-5); }
</style>

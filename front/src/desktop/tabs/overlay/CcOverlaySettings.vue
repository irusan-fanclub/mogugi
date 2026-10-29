<script setup lang="ts">
import { overlaySettings, updateOverlaySettings } from '../../overlay/overlayLink';
import {
    DEFAULT_BOSS_CC, DEFAULT_SELF_CC, type CcOverlaySettings as Cc, type CcSection, type SizeStep,
} from '@/lib/overlaySettings';
import DSegmented from '../../ui/DSegmented.vue';
import OpacityRange from './OpacityRange.vue';
import CcSectionList from './CcSectionList.vue';

const SIZES = [
    { value: 's', label: '小' },
    { value: 'm', label: '中' },
    { value: 'l', label: '大' },
] as const;
const SECTIONS: { key: CcSection; title: string; defaults: number[] }[] = [
    { key: 'boss', title: 'BOSS', defaults: DEFAULT_BOSS_CC },
    { key: 'self', title: '自身', defaults: DEFAULT_SELF_CC },
    { key: 'party', title: '隊友', defaults: DEFAULT_SELF_CC },
];

const set = (mut: (c: Cc) => void) => updateOverlaySettings(s => mut(s.cc));
</script>

<template>
  <div class="settings">
    <div class="setting">
      <div class="lbl">
        <div>透明度</div>
        <div class="hint">只影響背景，圖示維持不透明</div>
      </div>
      <OpacityRange
        data-cc-opacity
        :model-value="overlaySettings.cc.opacity"
        @update:model-value="v => set(c => { c.opacity = v; })"
      />
    </div>
    <div class="setting">
      <div class="lbl">圖示大小</div>
      <DSegmented
        :model-value="overlaySettings.cc.iconSize"
        :options="[...SIZES]"
        @update:model-value="(v: SizeStep) => set(c => { c.iconSize = v; })"
      />
    </div>
    <CcSectionList
      v-for="s in SECTIONS"
      :key="s.key"
      :title="s.title"
      :ids="overlaySettings.cc.sections[s.key]"
      :defaults="s.defaults"
      @update:ids="ids => set(c => { c.sections[s.key] = ids; })"
    />
  </div>
</template>

<style scoped>
.settings { display: flex; flex-direction: column; gap: var(--space-4); }
.setting { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
.hint { color: var(--c-text-dim); font-size: var(--fs-xs); }
</style>

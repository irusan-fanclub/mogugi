<script setup lang="ts">
import { computed } from 'vue';
import { layoutOf } from '@/lib/overlayComponents';
import { defaultDpsLook, DPS_FONT_PX, type DpsLook } from '@/lib/overlaySections';
import { overlaySettings, updateOverlaySettings } from '../../overlay/overlayLink';
import { useOverlayState } from '../../overlay/useOverlayState';
import DButton from '../../ui/DButton.vue';
import DCheckbox from '../../ui/DCheckbox.vue';
import IconButton from './IconButton.vue';
import PanelBgField from './PanelBgField.vue';
import SizeField, { type SizeValue } from './SizeField.vue';

const COLUMNS = [
    { key: 'dps', label: 'DPS' },
    { key: 'total', label: '總傷害' },
    { key: 'share', label: '佔比' },
] as const;
const TOP = [
    { key: 'boss', label: 'BOSS 名稱' },
    { key: 'hpPct', label: '血量 %' },
    { key: 'hpLeft', label: '剩餘血量' },
    { key: 'time', label: '時間' },
    { key: 'partyDps', label: '隊伍 DPS' },
] as const;
const MIN_ROWS = 1;
const MAX_ROWS = 20;

const { state, setLayout } = useOverlayState();
const d = computed(() => overlaySettings.value.dpsLook);
const set = (mut: (d: DpsLook) => void) => updateOverlaySettings(s => mut(s.dpsLook));
const setFont = (v: SizeValue) => set(x => { x.font = v.size; x.fpx = v.px; });
const resetLook = () => set(x => { const z = defaultDpsLook(); x.font = z.font; x.fpx = z.fpx; x.bg = z.bg; });

// 顯示列數 lives in the dps layout, not in the settings.
const rows = computed(() => layoutOf('dps', state.value?.layout).maxRows);
function stepRows(delta: number) {
    const lay = layoutOf('dps', state.value?.layout);
    const next = Math.min(MAX_ROWS, Math.max(MIN_ROWS, lay.maxRows + delta));
    if (next !== lay.maxRows) setLayout('dps', { ...lay, maxRows: next });
}
</script>

<template>
  <div class="ovs-page" data-dps-page>
    <h2>簡易戰鬥資訊</h2>
    <div class="ovs-box">
      <h3>外觀<IconButton kind="reset" data-reset-look @fire="resetLook" /></h3>
      <div class="ovs-field">
        <span class="ovs-lbl">字體大小</span>
        <SizeField :model-value="{ size: d.font, px: d.fpx }" :presets="DPS_FONT_PX" :min="10" :max="40" @update:model-value="setFont" />
      </div>
      <div class="ovs-field">
        <span class="ovs-lbl">顯示列數</span>
        <DButton size="sm" data-rows-dec aria-label="減少列數" :disabled="rows <= MIN_ROWS" @click="stepRows(-1)">−</DButton>
        <span class="rows-val" data-rows-val>{{ rows }}</span>
        <DButton size="sm" data-rows-inc aria-label="增加列數" :disabled="rows >= MAX_ROWS" @click="stepRows(1)">＋</DButton>
      </div>
      <PanelBgField :model-value="d.bg" :fallback="overlaySettings.general.bg" @update:model-value="v => set(x => { x.bg = v; })" />
    </div>
    <div class="ovs-box">
      <h3>內容</h3>
      <div class="ovs-field">
        <span class="ovs-lbl">每列顯示</span>
        <DCheckbox
          v-for="c in COLUMNS" :key="c.key" :model-value="d.columns[c.key]" :label="c.label"
          @update:model-value="v => set(x => { x.columns[c.key] = v; })"
        />
      </div>
      <div class="ovs-field">
        <span class="ovs-lbl">頂部資訊</span>
        <DCheckbox
          v-for="c in TOP" :key="c.key" :model-value="d.top[c.key]" :label="c.label"
          @update:model-value="v => set(x => { x.top[c.key] = v; })"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.rows-val { min-width: 2em; text-align: center; font-family: Consolas, "Cascadia Mono", "Courier New", ui-monospace, monospace; }
</style>

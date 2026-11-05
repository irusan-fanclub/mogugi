<script setup lang="ts">
import { defaultGeneral, type OverlayGeneral } from '@/lib/overlaySections';
import { overlaySettings, updateOverlaySettings } from '../../overlay/overlayLink';
import IconButton from './IconButton.vue';

type ColorKey = 'warn' | 'gone' | 'ok';
const COLORS: { key: ColorKey; label: string }[] = [
    { key: 'warn', label: '到期提醒' }, { key: 'gone', label: '失效' }, { key: 'ok', label: 'OK' },
];
const set = (mut: (g: OverlayGeneral) => void) => updateOverlaySettings(s => mut(s.general));
const val = (e: Event) => (e.target as HTMLInputElement).value;
const resetColors = () => set(g => { const d = defaultGeneral(); g.warn = d.warn; g.gone = d.gone; g.ok = d.ok; });
</script>

<template>
  <div class="ovs-page" data-general>
    <h2>通用</h2>
    <div class="ovs-box">
      <h3>面板<IconButton kind="reset" data-reset-bg @fire="set(g => { g.bg = defaultGeneral().bg; })" /></h3>
      <div class="ovs-field">
        <span class="ovs-lbl">面板底色</span>
        <input type="color" :value="overlaySettings.general.bg.color" data-general-bg @input="e => set(g => { g.bg.color = val(e); })">
      </div>
      <div class="ovs-field">
        <span class="ovs-lbl">透明度</span>
        <input
          type="range" min="0" max="100" step="5" :value="overlaySettings.general.bg.alpha" data-general-alpha aria-label="透明度"
          @input="e => set(g => { g.bg.alpha = Number(val(e)); })"
        >
        <span class="ovs-dim">{{ overlaySettings.general.bg.alpha }}%</span>
      </div>
    </div>
    <div class="ovs-box">
      <h3>提醒顏色<IconButton kind="reset" data-reset-colors @fire="resetColors" /></h3>
      <div v-for="c in COLORS" :key="c.key" class="ovs-field">
        <span class="ovs-lbl">{{ c.label }}</span>
        <input type="color" :value="overlaySettings.general[c.key]" :data-color="c.key" @input="e => set(g => { g[c.key] = val(e); })">
      </div>
    </div>
  </div>
</template>

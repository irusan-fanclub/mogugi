<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ComponentId } from '@/lib/overlayProtocol';
import { COMPONENTS, layoutOf } from '@/lib/overlayComponents';
import { useOverlayState } from '../../overlay/useOverlayState';
import DSwitch from '../../ui/DSwitch.vue';
import DButton from '../../ui/DButton.vue';
import LockBar from './LockBar.vue';
import DpsOverlaySettings from './DpsOverlaySettings.vue';
import CcOverlaySettings from './CcOverlaySettings.vue';
import CooldownOverlaySettings from './CooldownOverlaySettings.vue';
import AlertsSettings from './AlertsSettings.vue';
import { overlaySettings, updateOverlaySettings } from '../../overlay/overlayLink';

const NARROW_PX = 720;
const { state, setLayout, setLocked, setHotkey, restartElevated, setHidden, setVisibleHotkey } = useOverlayState();

const ITEMS: { id: ComponentId; label: string }[] = COMPONENTS.map(c => ({ id: c.id, label: c.name }));
const selected = ref<ComponentId>('dps');
const narrow = ref(false);
// Narrow mode only: whether the settings page is open instead of the list.
const detail = ref(false);
const root = ref<HTMLElement | null>(null);
let ro: ResizeObserver | undefined;

const title = computed(() => ITEMS.find(i => i.id === selected.value)!.label);
const MIN_ROWS = 1;
const MAX_ROWS = 20;
const rows = computed(() => layoutOf(selected.value, state.value?.layout).maxRows);
function stepRows(d: number) {
    const lay = layoutOf(selected.value, state.value?.layout);
    const next = Math.min(MAX_ROWS, Math.max(MIN_ROWS, lay.maxRows + d));
    if (next !== lay.maxRows) setLayout(selected.value, { ...lay, maxRows: next });
}
const pick = (id: ComponentId) => { selected.value = id; detail.value = true; };

onMounted(() => {
    if (root.value && typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(entries => {
            narrow.value = (entries[0]?.contentRect.width ?? 0) < NARROW_PX;
        });
        ro.observe(root.value);
    }
});
onBeforeUnmount(() => ro?.disconnect());
</script>

<template>
  <div ref="root" class="overlay-tab">
    <LockBar
      :locked="state?.locked ?? true"
      :hotkey="state?.hotkey ?? ''"
      :hotkey-error="state?.hotkeyError ?? ''"
      :elevated="state?.elevated ?? null"
      :elevate-error="state?.elevateError ?? ''"
      :hidden="state?.hidden ?? false"
      :visible-hotkey="state?.visibleHotkey ?? ''"
      :visible-hotkey-error="state?.visibleHotkeyError ?? ''"
      @set-locked="setLocked"
      @set-hotkey="setHotkey"
      @restart-elevated="restartElevated"
      @set-hidden="setHidden"
      @set-visible-hotkey="setVisibleHotkey"
    />
    <div v-if="state && !state.licensed" class="unlicensed" data-unlicensed>未授權，overlay 不會開啟</div>
    <div v-if="state && !state.gameFound" class="notice" data-no-game>找不到遊戲視窗，遊戲啟動後 overlay 會自動出現</div>
    <div class="scale">
      <span>整體縮放</span>
      <input
        data-overlay-scale type="range" min="80" max="150" step="10" aria-label="整體縮放"
        :value="overlaySettings.scale"
        @input="e => updateOverlaySettings(s => { s.scale = Number((e.target as HTMLInputElement).value); })"
      >
      <span class="val">{{ overlaySettings.scale }}%</span>
      <span class="grow" />
      <span class="hint">overlay 只在視窗模式或無邊框視窗模式下看得到</span>
    </div>
    <div class="body">
      <nav v-if="!narrow || !detail" class="list" :class="{ full: narrow }" data-overlay-list>
        <div
          v-for="it in ITEMS"
          :key="it.id"
          class="item"
          :class="{ on: !narrow && selected === it.id }"
          data-overlay-item
          @click="pick(it.id)"
        >
          <span class="name">{{ it.label }}</span>
          <span class="sw" @click.stop>
            <DSwitch
              :model-value="layoutOf(it.id, state?.layout).enabled"
              @update:model-value="v => setLayout(it.id, { ...layoutOf(it.id, state?.layout), enabled: v })"
            />
          </span>
        </div>
      </nav>
      <section v-if="!narrow || detail" class="pane" data-overlay-settings>
        <div class="phead">
          <DButton v-if="narrow" size="sm" @click="detail = false">‹ 返回</DButton>
          <span class="ptitle">{{ title }}</span>
        </div>
        <div class="rows">
          <span>顯示列數</span>
          <DButton size="sm" data-rows-dec aria-label="減少列數" :disabled="rows <= MIN_ROWS" @click="stepRows(-1)">−</DButton>
          <span class="rows-val" data-rows-val>{{ rows }}</span>
          <DButton size="sm" data-rows-inc aria-label="增加列數" :disabled="rows >= MAX_ROWS" @click="stepRows(1)">＋</DButton>
        </div>
        <DpsOverlaySettings v-if="selected === 'dps'" />
        <CcOverlaySettings v-else-if="selected === 'cc'" />
        <CooldownOverlaySettings v-else-if="selected === 'cooldown'" />
        <AlertsSettings v-else />
      </section>
    </div>
  </div>
</template>

<style scoped>
.overlay-tab { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.unlicensed { padding: var(--space-2) var(--space-4); color: var(--c-err); font-size: var(--fs-sm); border-bottom: 1px solid var(--c-line); }
.notice { padding: var(--space-2) var(--space-4); color: var(--c-warn); font-size: var(--fs-sm); border-bottom: 1px solid var(--c-line); }
.scale { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--c-line); font-size: var(--fs-sm); }
.scale input { width: 160px; accent-color: var(--c-accent); }
.scale .val { width: 3em; color: var(--c-text-dim); }
.scale .grow { flex: 1; }
.scale .hint { color: var(--c-text-dim); font-size: var(--fs-xs); }
.body { flex: 1; min-height: 0; display: flex; }
.list { width: 220px; flex: none; border-right: 1px solid var(--c-line); overflow-y: auto; }
.list.full { width: 100%; border-right: 0; }
.item { display: flex; align-items: center; justify-content: space-between; min-height: calc(var(--row-h) + 6px); padding: 0 var(--space-4); cursor: pointer; }
.item:hover { background: var(--c-surface-2); }
.item.on { background: var(--c-surface-2); box-shadow: inset 2px 0 0 var(--c-accent); }
.pane { flex: 1; min-width: 0; padding: var(--space-4); overflow-y: auto; scrollbar-gutter: stable; }
.phead { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); }
.rows { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); font-size: var(--fs-sm); }
.rows-val { min-width: 2em; text-align: center; font-variant-numeric: tabular-nums; }
.ptitle { font-size: var(--fs-lg, 16px); font-weight: 600; }
</style>

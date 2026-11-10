<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { CcSectionId } from '@/lib/overlaySections';
import { useOverlayState } from '../../overlay/useOverlayState';
import DButton from '../../ui/DButton.vue';
import LockBar from './LockBar.vue';
import GeneralSettings from './GeneralSettings.vue';
import DpsOverlaySettings from './DpsOverlaySettings.vue';
import CcSectionSettings from './CcSectionSettings.vue';
import CooldownSettings from './CooldownSettings.vue';
import AlertsSettings from './AlertsSettings.vue';
import ShareExportDialog from './ShareExportDialog.vue';
import ShareImportDialog from './ShareImportDialog.vue';
import { overlaySettings, updateOverlaySettings } from '../../overlay/overlayLink';
import './settingsPage.css';

type Page = 'general' | 'dps' | CcSectionId | 'cooldown' | 'alerts';
const PAGES: { id: Page; label: string }[] = [
    { id: 'general', label: '通用' }, { id: 'dps', label: '簡易戰鬥資訊' }, { id: 'ccBoss', label: 'BOSS CC' },
    { id: 'ccSelf', label: '自己 CC' }, { id: 'ccParty', label: '隊伍 CC' }, { id: 'cooldown', label: '技能冷卻' },
    { id: 'misc', label: '雜項' }, { id: 'burst', label: '爆發提示（開發中）' }, { id: 'alerts', label: '提醒（開發中）' },
];
const isCc = (p: Page): p is CcSectionId => p === 'ccBoss' || p === 'ccSelf' || p === 'ccParty' || p === 'burst' || p === 'misc';

const NARROW_PX = 720;
const { state, setLocked, setHotkey, restartElevated, setHidden, setVisibleHotkey } = useOverlayState();

const exportOpen = ref(false);
const importOpen = ref(false);
const selected = ref<Page>('general');
const narrow = ref(false);
// Narrow mode only: whether the settings page is open instead of the list.
const detail = ref(false);
const root = ref<HTMLElement | null>(null);
let ro: ResizeObserver | undefined;

const pick = (id: Page) => { selected.value = id; detail.value = true; };

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
      <DButton size="sm" data-share-export @click="exportOpen = true"><i class="mdi mdi-export-variant" />匯出設定</DButton>
      <DButton size="sm" data-share-import @click="importOpen = true"><i class="mdi mdi-import" />匯入設定</DButton>
    </div>
    <div class="body">
      <nav v-if="!narrow || !detail" class="list" :class="{ full: narrow }" data-overlay-list>
        <div
          v-for="p in PAGES"
          :key="p.id"
          class="item"
          :class="{ on: !narrow && selected === p.id }"
          data-overlay-item
          @click="pick(p.id)"
        >
          {{ p.label }}
        </div>
      </nav>
      <section v-if="!narrow || detail" class="pane" data-overlay-settings>
        <div v-if="narrow" class="phead">
          <DButton size="sm" @click="detail = false">‹ 返回</DButton>
        </div>
        <GeneralSettings v-if="selected === 'general'" />
        <DpsOverlaySettings v-else-if="selected === 'dps'" />
        <CcSectionSettings v-else-if="isCc(selected)" :key="selected" :section="selected" />
        <CooldownSettings v-else-if="selected === 'cooldown'" />
        <template v-else>
          <div class="ovs-page"><h2>提醒</h2></div>
          <AlertsSettings />
        </template>
      </section>
    </div>
    <ShareExportDialog v-model="exportOpen" />
    <ShareImportDialog v-model="importOpen" />
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
/* The item picker covers the nav and the page. */
.body { position: relative; flex: 1; min-height: 0; display: flex; }
.list { width: 150px; flex: none; border-right: 1px solid var(--c-line); overflow-y: auto; }
.list.full { width: 100%; border-right: 0; }
.item { display: flex; align-items: center; min-height: calc(var(--row-h) + 6px); padding: 0 var(--space-4); cursor: pointer; font-size: var(--fs-sm); }
.item:hover { background: var(--c-surface-2); }
.item.on { background: var(--c-surface-2); box-shadow: inset 2px 0 0 var(--c-accent); }
.pane { flex: 1; min-width: 0; padding: var(--space-4); overflow-y: auto; scrollbar-gutter: stable; }
.phead { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-4); }
</style>

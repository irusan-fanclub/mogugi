<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { sourceState } from '@/protocols';
import { captureStatus } from '@/store';
import { desktopWindow, emitDesktop } from '@/lib/desktopBridge';
import { isDesktop } from '@/lib/runtimeEnv';
import { sourceBannerText } from '@/lib/sourceBanner';
import DButton from '../ui/DButton.vue';
import DIconButton from '../ui/DIconButton.vue';
import ImportMenu from './ImportMenu.vue';
import { captureView } from './captureView';

const props = withDefaults(defineProps<{
    variant: 'main' | 'chart';
    title?: string;
    connected?: boolean;
    ownerName?: string;
    licenseUser?: string;
    source?: sourceState | null;
}>(), { connected: false, ownerName: '', licenseUser: '', source: null });

const version = __APP_VERSION__;
const logo = "/favicon.ico"; // from public/, so not a bundled asset
const status = computed(() => captureView(props.connected, captureStatus.value));
const replaying = computed(() => props.source?.Mode === 'replay');
const replayText = computed(() => sourceBannerText(props.source));

const desktop = isDesktop();
const maximised = ref(false);
async function syncMax() {
    try { maximised.value = !!(await (await desktopWindow())?.IsMaximised()); } catch { /* not in a Wails window */ }
}
onMounted(() => {
    if (!desktop) return;
    void syncMax();
    window.addEventListener('resize', syncMax);
});
onBeforeUnmount(() => window.removeEventListener('resize', syncMax));

function onDblClick(e: MouseEvent) {
    if (!desktop || (e.target as HTMLElement).closest('[data-nodrag]')) return;
    void desktopWindow().then(w => w?.ToggleMaximise());
}
</script>

<template>
  <header class="titlebar" data-drag @dblclick="onDblClick">
    <div class="left">
      <img class="logo" :src="logo" alt="" width="16" height="16">
      <span v-if="variant === 'main'" class="name">mogugi <span class="ver">v{{ version }}</span></span>
      <span v-else class="name">{{ title }}</span>
    </div>

    <div class="mid">
      <template v-if="variant === 'main'">
        <span class="dot" :class="status.tone" />
        <span class="status">{{ status.text }}</span>
        <span v-if="ownerName" class="owner">{{ ownerName }}</span>
        <span v-if="licenseUser" class="dim">{{ licenseUser }}</span>
        <span v-if="replayText" class="replay" data-replay-hint data-nodrag>
          <i class="mdi mdi-play-circle-outline" />
          <span class="replay-text" :title="replayText">{{ replayText }}</span>
          <DButton v-if="desktop && replaying" size="sm" variant="danger" class="stop" data-replay-stop @click="emitDesktop('replay:stop')">結束重播</DButton>
        </span>
      </template>
    </div>

    <div class="right">
      <ImportMenu v-if="desktop && variant === 'main'" :replaying="replaying" />
      <div v-if="desktop" class="win" data-nodrag>
        <DIconButton icon="mdi-window-minimize" title="最小化" @click="desktopWindow().then(w => w?.Minimise())" />
        <DIconButton
          :icon="maximised ? 'mdi-window-restore' : 'mdi-window-maximize'"
          :title="maximised ? '還原' : '最大化'"
          @click="desktopWindow().then(w => w?.ToggleMaximise())"
        />
        <DIconButton icon="mdi-close" title="關閉" @click="desktopWindow().then(w => w?.Close())" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.titlebar {
    display: flex;
    align-items: center;
    gap: var(--space-5);
    height: 32px;
    padding-left: var(--space-4);
    background: var(--c-bg-deep);
    border-bottom: 1px solid var(--c-line);
    flex: none;
}
.left, .mid, .right { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.left { flex: none; }
.mid { flex: 1; overflow: hidden; }
.right { flex: none; }
.win { display: flex; flex: none; }
.name { font-size: var(--fs-md); white-space: nowrap; }
.ver { color: var(--c-text-dim); font-size: var(--fs-sm); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c-text-dim); flex: none; }
.dot.ok { background: var(--c-ok); }
.dot.warn { background: var(--c-warn); }
.dot.err { background: var(--c-err); }
.status, .owner { font-size: var(--fs-sm); white-space: nowrap; }
.dim { color: var(--c-text-dim); font-size: var(--fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.replay { display: inline-flex; min-width: 0; align-items: center; gap: var(--space-3); color: var(--c-accent); font-size: var(--fs-sm); }
.stop { flex: none; }
.replay-text { min-width: 0; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>

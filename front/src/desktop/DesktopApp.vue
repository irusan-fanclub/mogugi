<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue';
import { initDesktop } from '@/lib/desktopBridge';
import { createBackendSession, type BackendSession } from '@/lib/backendSession';
import { loadNameMaps } from '@/lib/gameData';
import { installIconFallback } from '@/lib/iconFallback';
import { LicenseRequiredError } from '@/lib/configApi';
import { isDesktop, wsUrl } from '@/lib/runtimeEnv';
import DAlert from './ui/DAlert.vue';
import DButton from './ui/DButton.vue';
import DToast from './ui/DToast.vue';
import DContextMenu from './ui/DContextMenu.vue';
import TitleBar from './shell/TitleBar.vue';
import TabBar from './shell/TabBar.vue';
import Notices from './shell/Notices.vue';
import LicenseScreen from './shell/LicenseScreen.vue';
import { LICENSE_GUARD_KEY, SESSION_KEY, TAB_SWITCH_KEY } from './session';
import { PINNED_TABS, TABS } from './tabs/registry';
import { startChartHub } from './windows/chartHub';
import { startOverlayLink } from './overlay/overlayLink';
import { startFrameRecords } from './overlay/frameRecords';
import { useOverlayState } from './overlay/useOverlayState';
import { useToast } from './ui/useToast';

type Phase = 'boot' | 'license' | 'ready' | 'error';
const phase = ref<Phase>('boot');
const errorMsg = ref('');
const licenseUser = ref('');
const session = shallowRef<BackendSession | null>(null);

const ids = [...TABS.map(t => t.id), ...PINNED_TABS.map(t => t.id)];
const tab = ref(TABS[0].id);
const current = computed(() => [...TABS, ...PINNED_TABS].find(t => t.id === tab.value) ?? TABS[0]);

provide(SESSION_KEY, () => session.value);
// Any /api 403 sends the user back to the license screen.
function licenseGuard(e: unknown): boolean {
    if (!(e instanceof LicenseRequiredError)) return false;
    phase.value = 'license';
    return true;
}
provide(LICENSE_GUARD_KEY, licenseGuard);
provide(TAB_SWITCH_KEY, (id: string) => { if (ids.includes(id)) tab.value = id; });

async function enter() {
    await loadNameMaps();
    if (!session.value) {
        session.value = createBackendSession({ url: wsUrl() + '?history=1', history: true });
        session.value.connect();
    }
    phase.value = 'ready';
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Three outcomes: license inactive, backend unreachable, or a boot failure after activation.
async function checkLicense() {
    let activated: boolean;
    try {
        const d = await (await fetch('/api/license/status')).json();
        licenseUser.value = d.displayName || '';
        activated = !!d.activated;
    } catch (e) {
        errorMsg.value = `無法連線到本機服務：${msgOf(e)}`;
        phase.value = 'error';
        return;
    }
    if (!activated) { phase.value = 'license'; return; }
    try {
        await enter();
    } catch (e) {
        errorMsg.value = `啟動失敗：${msgOf(e)}`;
        phase.value = 'error';
    }
}

// A license that lapses mid-session must send the user back to activation.
const RECHECK_MS = 60_000;
let recheck: ReturnType<typeof setInterval> | undefined;
async function recheckLicense() {
    try {
        const d = await (await fetch('/api/license/status')).json();
        if (phase.value === 'ready' && !d.activated) phase.value = 'license';
    } catch { /* transient; the next tick tries again */ }
}
// Chart windows are served only while the app is ready (not on the license or error screens).
let hub: Promise<() => void> | undefined;
function stopHub() {
    const h = hub;
    hub = undefined;
    h?.then(stop => stop()).catch(e => console.error('chart hub stop failed', e));
}
// The overlay link follows the same lifecycle as the hub.
let link: Promise<() => void> | undefined;
let stopFrames: (() => void) | undefined;
function stopLink() {
    stopFrames?.();
    stopFrames = undefined;
    const l = link;
    link = undefined;
    l?.then(stop => stop()).catch(e => console.error('overlay link stop failed', e));
}

// A registration failure is toasted per attempt: once per text, again after the error cleared or a new set call.
const toast = useToast();
const { state: overlayState, refresh: refreshOverlayState, hotkeyAttempts, visibleHotkeyAttempts } = useOverlayState();
const hotkeyErrorKeys = [
    { key: 'hotkeyError', attempts: hotkeyAttempts },
    { key: 'visibleHotkeyError', attempts: visibleHotkeyAttempts },
] as const;
const lastHotkeyErrors = hotkeyErrorKeys.map(k => ({ err: '', attempts: k.attempts.value }));
watch(overlayState, st => {
    hotkeyErrorKeys.forEach(({ key, attempts }, i) => {
        const last = lastHotkeyErrors[i];
        const err = st?.[key] ?? '';
        if (!err) { last.err = ''; return; }
        if (err !== last.err || attempts.value !== last.attempts) toast.show(err, 6000);
        last.err = err;
        last.attempts = attempts.value;
    });
});

watch(phase, (p, prev) => {
    if (recheck !== undefined) { clearInterval(recheck); recheck = undefined; }
    if (p === 'ready') recheck = setInterval(recheckLicense, RECHECK_MS);
    stopHub();
    stopLink();
    // Leaving ready (e.g. license lapsed): Go closes the overlays when it is no longer licensed.
    if (isDesktop() && prev === 'ready' && p !== 'ready') void refreshOverlayState();
    if (p === 'ready') {
        const started = startChartHub();
        hub = started;
        started.catch(e => console.error('chart hub start failed', e));
        if (isDesktop()) {
            const linked = startOverlayLink();
            link = linked;
            stopFrames = startFrameRecords();
            linked.catch(e => console.error('overlay link start failed', e));
            // After the hello listener exists, refresh the overlay state and the license flag.
            void linked.then(() => refreshOverlayState()).catch(() => {});
        }
    }
});

let removeFallback: (() => void) | undefined;
onMounted(async () => {
    removeFallback = installIconFallback();
    await initDesktop();
    await checkLicense();
});
onBeforeUnmount(() => {
    removeFallback?.();
    if (recheck !== undefined) clearInterval(recheck);
    stopHub();
    stopLink();
});
</script>

<template>
  <div class="desktop-app">
    <template v-if="phase === 'ready' && session">
      <TitleBar
        variant="main"
        :connected="session.connected.value"
        :owner-name="session.ownerName.value"
        :license-user="licenseUser"
        :source="session.source.value"
      />
      <Notices :session="session" />
      <TabBar v-model="tab" :tabs="TABS" :pinned="PINNED_TABS" />
      <main class="content">
        <KeepAlive>
          <component :is="current.component" :key="current.id" />
        </KeepAlive>
      </main>
    </template>
    <template v-else-if="phase === 'license'">
      <TitleBar variant="chart" title="mogugi" />
      <LicenseScreen @activated="checkLicense" />
    </template>
    <template v-else-if="phase === 'error'">
      <TitleBar variant="chart" title="mogugi" />
      <div class="boot-error" data-boot-error>
        <DAlert kind="error">{{ errorMsg }}</DAlert>
        <DButton variant="primary" data-retry @click="checkLicense">重試</DButton>
      </div>
    </template>
    <DToast />
    <DContextMenu />
  </div>
</template>

<style scoped>
.desktop-app { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.boot-error { display: flex; flex-direction: column; align-items: center; gap: var(--space-4); margin: auto; max-width: 420px; padding: var(--space-5); }
/* Once the page scrolls, Chromium keeps LCD text in the scrolled layer only over an opaque
   background painted with the contents (local); without it the text turns grayscale and thin. */
.content { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; background: var(--c-bg); background-attachment: local; }
</style>

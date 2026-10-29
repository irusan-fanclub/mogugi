<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { captureStatus } from '@/store';
import { fetchCaptureStatus } from '@/lib/captureStatus';
import { isDesktop } from '@/lib/runtimeEnv';

const props = defineProps<{ connected: boolean }>();

const NPCAP_URL = 'https://npcap.com';

// Unknown status shows as all-false until the socket or the fetch reports.
const status = computed(() => captureStatus.value ?? {
    npcapOk: false, gameDetected: false, capturing: false, lastPacketAt: 0,
});
const checks = computed(() => [
    { label: '後端已連線', ok: props.connected, dim: false },
    { label: 'Npcap 已安裝', ok: status.value.npcapOk, dim: false },
    { label: '偵測到遊戲連線', ok: status.value.gameDetected, dim: !props.connected },
    { label: '正在擷取封包', ok: status.value.capturing, dim: !props.connected },
]);

onMounted(async () => {
    if (captureStatus.value) return;
    const s = await fetchCaptureStatus();
    if (s && !captureStatus.value) captureStatus.value = s;
});


// The Wails WebView cannot open external pages itself; hand the URL to the OS browser.
function openNpcap() {
    if (isDesktop()) void import('@wailsio/runtime').then(rt => rt.Browser.OpenURL(NPCAP_URL));
    else window.open(NPCAP_URL, '_blank', 'noopener');
}
</script>

<template>
  <section class="about" data-npcap-section>
    <h2>封包擷取（Npcap）</h2>
    <p class="npcap">
      mogugi 需要 Npcap 才能讀取「瑪奇」的網路封包；若下方顯示未安裝，請到
      <a href="#" data-npcap @click.prevent="openNpcap">{{ NPCAP_URL }}</a>
      下載安裝（預設選項即可），安裝後重新啟動 mogugi。
    </p>
    <ul class="checks">
      <li
        v-for="c in checks"
        :key="c.label"
        data-check
        :data-ok="c.ok"
        :class="{ ok: c.ok, dim: c.dim }"
      >
        <i class="mdi" :class="c.ok ? 'mdi-check' : 'mdi-close'" />{{ c.label }}
      </li>
    </ul>
  </section>
</template>

<style scoped>
.about h2 { margin: 0 0 var(--space-3); font-size: var(--fs-lg); }
.npcap { margin: 0 0 var(--space-3); font-size: var(--fs-sm); }
.npcap a { color: var(--c-share); }
.checks { margin: 0; padding: 0; list-style: none; }
.checks li { display: flex; align-items: center; gap: var(--space-3); min-height: var(--row-h); color: var(--c-err); font-size: var(--fs-md); }
.checks li.ok { color: var(--c-ok); }
.checks li.dim { opacity: 0.4; }
</style>

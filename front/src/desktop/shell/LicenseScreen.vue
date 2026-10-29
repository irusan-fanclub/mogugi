<script setup lang="ts">
import DiscordIcon from '../ui/DiscordIcon.vue';
import { computed, onBeforeUnmount, ref } from 'vue';
import { createLicenseFlow } from '@/lib/licenseFlow';
import { isDesktop } from '@/lib/runtimeEnv';
import DAlert from '../ui/DAlert.vue';
import DButton from '../ui/DButton.vue';
import DSpinner from '../ui/DSpinner.vue';

const emit = defineEmits<{ activated: [] }>();

// The Wails WebView cannot open external pages itself; hand the URL to the OS browser.
function openUrl(u: string) {
    if (isDesktop()) void import('@wailsio/runtime').then(rt => rt.Browser.OpenURL(u));
    else window.open(u, '_blank', 'noopener');
}

const flow = createLicenseFlow({ fetch: (...a) => fetch(...a), openUrl });
const state = ref(flow.state);
const message = ref(flow.message);
const remaining = ref(flow.remaining);
const busy = ref(false);

const off = flow.onChange(() => {
    const prev = state.value;
    state.value = flow.state;
    message.value = flow.message;
    remaining.value = flow.remaining;
    busy.value = flow.busy;
    if (flow.state === 'activated' && prev !== 'activated') emit('activated');
});
onBeforeUnmount(() => { off(); flow.cancel(); });

const kind = computed(() => (state.value === 'error' ? 'error' : 'info'));
</script>

<template>
  <div class="license" data-license-screen>
    <div class="card">
      <h2>啟用 mogugi</h2>
      <template v-if="state === 'waiting'">
        <p class="dim">已在瀏覽器開啟 Discord 授權頁面。完成授權後，這裡會自動啟用。</p>
        <div class="wait">
          <DSpinner :size="28" />
          <span class="dim">等待授權中，剩餘 {{ remaining }} 秒</span>
        </div>
        <DButton class="full" @click="flow.cancel()">取消</DButton>
      </template>
      <template v-else>
        <p class="dim">用 Discord 登入即可啟用。</p>
        <DButton class="full" variant="primary" :loading="busy" data-discord @click="flow.start()">
          <DiscordIcon />用 Discord 登入
        </DButton>
        <DAlert v-if="message" :kind="kind" class="msg">{{ message }}</DAlert>
      </template>
    </div>
  </div>
</template>

<style scoped>
.license { flex: 1; display: flex; align-items: center; justify-content: center; padding: var(--space-5); }
.card {
    width: 100%;
    max-width: 380px;
    padding: var(--space-5) 24px 24px;
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-surface);
}
h2 { margin: 0 0 var(--space-4); font-size: var(--fs-lg); text-align: center; font-weight: 600; }
.dim { color: var(--c-text-dim); font-size: var(--fs-sm); text-align: center; margin: 0 0 var(--space-5); }
.wait { display: flex; flex-direction: column; align-items: center; gap: var(--space-3); margin-bottom: var(--space-5); }
.full { width: 100%; }
.msg { margin-top: var(--space-4); }
</style>

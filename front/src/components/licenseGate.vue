<template>
  <v-container class="d-flex align-center justify-center" style="min-height: 100vh;">
    <v-card max-width="440" width="100%" class="pa-8" elevation="8" rounded="lg">
      <h2 class="text-h5 text-center mb-2">啟用 mogugi</h2>

      <template v-if="waiting">
        <p class="text-body-2 text-medium-emphasis text-center mb-6">
          已在瀏覽器開啟 Discord 授權頁面。完成授權後，這裡會自動啟用。
        </p>
        <div class="d-flex flex-column align-center mb-4">
          <v-progress-circular indeterminate color="primary" size="40" class="mb-4" />
          <span class="text-caption text-medium-emphasis">
            等待授權中，剩餘 {{ remaining }} 秒
          </span>
        </div>
        <v-btn variant="text" block @click="cancelWaiting">取消</v-btn>
      </template>

      <template v-else>
        <p class="text-body-2 text-medium-emphasis text-center mb-6">
          用 Discord 登入即可啟用。
        </p>
        <v-btn color="primary" block size="large" prepend-icon="mdi-discord"
          :loading="oauthBusy" @click="startOAuth">用 Discord 登入</v-btn>

        <v-alert v-if="oauthMsg" :type="oauthMsgType" density="compact"
          variant="tonal" class="mt-4 text-body-2">{{ oauthMsg }}</v-alert>
      </template>
    </v-card>
  </v-container>
</template>

<script lang="ts">
import { defineComponent, ref, onUnmounted } from 'vue';

// Matches the Go side's listener window; there is nothing to wait for once
// that closes.
const WAIT_SECONDS = 120;
const POLL_MS = 1500;

// Naming the ports is the whole message: with no paste fallback, freeing one
// of them is the user's only way out, and they cannot do that without knowing
// which to look for.
const PORTS_BUSY_MSG =
  '啟用需要 53682、53683、53684 其中一個連接埠，目前三個都被其他程式占用。'
  + '請關掉占用的程式（rclone 預設會用 53682）後再試一次。';

export default defineComponent({
  name: 'LicenseGate',
  emits: ['activated'],
  setup(_, { emit }) {
    const oauthBusy = ref(false);
    const oauthMsg = ref('');
    const oauthMsgType = ref<'error' | 'info'>('error');
    const waiting = ref(false);
    const remaining = ref(WAIT_SECONDS);

    let poll: number | undefined;
    let tick: number | undefined;

    const stopWaiting = () => {
      if (poll !== undefined) window.clearInterval(poll);
      if (tick !== undefined) window.clearInterval(tick);
      poll = tick = undefined;
      waiting.value = false;
    };
    onUnmounted(stopWaiting);

    const cancelWaiting = () => {
      stopWaiting();
      oauthMsgType.value = 'info';
      oauthMsg.value = '已取消等待。授權頁面若已開啟，可以直接關掉。';
    };

    // The Go side activates as soon as Discord calls back, so the frontend
    // only has to notice that it happened.
    const startPolling = () => {
      waiting.value = true;
      remaining.value = WAIT_SECONDS;

      tick = window.setInterval(() => {
        remaining.value -= 1;
        if (remaining.value <= 0) {
          stopWaiting();
          oauthMsgType.value = 'error';
          oauthMsg.value = '授權逾時，請再試一次。';
        }
      }, 1000);

      poll = window.setInterval(async () => {
        try {
          const r = await fetch('/api/license/status');
          if ((await r.json()).activated) {
            stopWaiting();
            emit('activated');
          }
        } catch { /* 本機服務短暫沒回應就等下一次 */ }
      }, POLL_MS);
    };

    const startOAuth = async () => {
      oauthMsg.value = '';
      oauthBusy.value = true;
      try {
        const r = await fetch('/api/license/oauth/start', { method: 'POST' });
        const data = await r.json();
        if (r.status === 409) {
          oauthMsgType.value = 'error';
          oauthMsg.value = PORTS_BUSY_MSG;
          return;
        }
        if (!r.ok || !data.authUrl) {
          oauthMsgType.value = 'error';
          oauthMsg.value = '無法開始授權，請稍後再試。';
          return;
        }
        window.open(data.authUrl, '_blank', 'noopener');
        startPolling();
      } catch {
        oauthMsgType.value = 'error';
        oauthMsg.value = '無法連線到本機服務，請稍後再試。';
      } finally {
        oauthBusy.value = false;
      }
    };

    return {
      oauthBusy, oauthMsg, oauthMsgType, startOAuth,
      waiting, remaining, cancelWaiting,
    };
  },
});
</script>

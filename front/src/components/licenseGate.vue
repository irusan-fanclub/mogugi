<template>
  <v-container class="d-flex flex-column align-center justify-center"
    style="min-height: 100vh; max-width: 520px;">
    <h2 class="mb-2">啟用 dilmatulgi</h2>
    <p class="text-medium-emphasis mb-4" style="text-align: center;">
      請貼上從 Discord 機器人取得的驗證碼。每組驗證碼僅供本人使用，
      且需於取得後 30 分鐘內啟用。
    </p>
    <v-text-field v-model="code" label="驗證碼 (MOMETER-...)" variant="outlined"
      density="comfortable" class="w-100" :error-messages="errorMsg"
      @keyup.enter="activate" />
    <v-btn color="primary" block :loading="busy" @click="activate">啟用</v-btn>
  </v-container>
</template>

<script lang="ts">
import { defineComponent, ref } from 'vue';

export default defineComponent({
  name: 'LicenseGate',
  emits: ['activated'],
  setup(_, { emit }) {
    const code = ref('');
    const busy = ref(false);
    const errorMsg = ref('');

    const activate = async () => {
      errorMsg.value = '';
      busy.value = true;
      try {
        const r = await fetch('/api/license/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: code.value.trim() }),
        });
        const data = await r.json();
        if (data.ok) {
          emit('activated');
          return;
        }
        errorMsg.value = data.error === 'expired'
          ? '此驗證碼已過啟用期限，請向機器人重新索取。'
          : '驗證碼無效，請確認後再試。';
      } catch {
        errorMsg.value = '無法連線到本機服務，請稍後再試。';
      } finally {
        busy.value = false;
      }
    };

    return { code, busy, errorMsg, activate };
  },
});
</script>

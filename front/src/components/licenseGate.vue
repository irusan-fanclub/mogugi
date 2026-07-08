<template>
  <!-- 卡片式排版：欄位/按鈕不放在會拉伸子元素的 100vh flex-column 裡
       （Vuetify .v-input 有 flex:1 1 auto，直排時會被撐到吃滿剩餘高度）。 -->
  <v-container class="d-flex align-center justify-center" style="min-height: 100vh;">
    <v-card max-width="440" width="100%" class="pa-8" elevation="8" rounded="lg">
      <h2 class="text-h5 text-center mb-2">啟用 mogugi</h2>
      <p class="text-body-2 text-medium-emphasis text-center mb-6">
        請貼上從 Discord 機器人取得的驗證碼。每組驗證碼僅供本人使用，
        且需於取得後 30 分鐘內啟用。
      </p>
      <v-text-field v-model="code" label="驗證碼 (MOGUGI-...)" variant="outlined"
        density="comfortable" :error-messages="errorMsg"
        autofocus @keyup.enter="activate" />
      <v-btn color="primary" block size="large" class="mt-2"
        :loading="busy" @click="activate">啟用</v-btn>
    </v-card>
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

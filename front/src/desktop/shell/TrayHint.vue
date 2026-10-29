<template>
  <div v-if="open" class="tray-hint-mask" data-testid="tray-hint">
    <div class="tray-hint-card" role="dialog" aria-modal="true">
      <p>mogugi 會繼續在背景執行，可從右下角系統匣圖示叫出或結束。</p>
      <div class="tray-hint-actions">
        <button type="button" @click="ack">知道了</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
// Plain markup shared by the desktop shell notices.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { emitDesktop, onDesktopEvent } from '@/lib/desktopBridge';

const open = ref(false);
let off: (() => void) | undefined;
let gone = false;

onMounted(async () => {
  const unsub = await onDesktopEvent('desktop:tray-hint', () => { open.value = true; });
  if (gone) unsub?.(); else off = unsub;
});
onBeforeUnmount(() => { gone = true; off?.(); });

function ack() {
  open.value = false;
  void emitDesktop('desktop:tray-hint-ack');
}
</script>

<style scoped>
.tray-hint-mask { position: fixed; inset: 0; z-index: 3000; display: flex; align-items: center; justify-content: center; background: rgba(0, 0, 0, 0.5); }
.tray-hint-card { max-width: 420px; margin: 16px; padding: 24px; border-radius: 8px; background: #2a2a2a; color: #e0e0e0; font-family: 'Segoe UI', 'Microsoft JhengHei', sans-serif; }
.tray-hint-card p { margin: 0 0 16px; }
.tray-hint-actions { display: flex; justify-content: flex-end; }
.tray-hint-actions button { background: #5c6bc0; color: #fff; border: 0; border-radius: 4px; padding: 6px 16px; cursor: pointer; }
</style>

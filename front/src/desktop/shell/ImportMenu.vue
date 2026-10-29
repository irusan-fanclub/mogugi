<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { emitDesktop } from '@/lib/desktopBridge';
import { loadSetting, saveSetting } from '@/lib/settingsStorage';
import DButton from '../ui/DButton.vue';
import DCheckbox from '../ui/DCheckbox.vue';

defineProps<{ replaying?: boolean }>();

const open = ref(false);
const importBattles = ref(loadSetting('importBattles', false, (v): v is boolean => typeof v === 'boolean'));
watch(importBattles, v => saveSetting('importBattles', v));

const wrap = ref<HTMLElement>();
function onDown(e: Event) {
    if (open.value && !wrap.value?.contains(e.target as Node)) open.value = false;
}
onMounted(() => document.addEventListener('pointerdown', onDown));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDown));

function choose() {
    open.value = false;
    void emitDesktop('replay:open', { importBattles: importBattles.value });
}
</script>

<template>
  <div ref="wrap" class="import-menu" data-import data-nodrag>
    <DButton size="sm" :disabled="replaying" data-import-btn @click="open = !open">
      <i class="mdi mdi-file-import-outline" />匯入
    </DButton>
    <div v-if="open && !replaying" class="pop" role="dialog" aria-label="匯入">
      <DCheckbox v-model="importBattles" label="匯入戰鬥紀錄" />
      <DButton size="sm" variant="primary" data-choose-file @click="choose">選擇檔案…</DButton>
    </div>
  </div>
</template>

<style scoped>
.import-menu { position: relative; }
.pop {
    position: absolute;
    top: calc(100% + var(--space-2));
    right: 0;
    z-index: 100;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-4);
    border: 1px solid var(--c-line);
    border-radius: var(--radius);
    background: var(--c-surface-2);
    white-space: nowrap;
}
</style>

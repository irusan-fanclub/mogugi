<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { settingsStorage } from '@/lib/settingsStorage';
import DDialog from '../../ui/DDialog.vue';
import DButton from '../../ui/DButton.vue';
import { ccDefaultsFingerprint, ccDiffersFromDefaults, resetCcToDefaults } from './ccDefaults';

// Asks only when a release changed the CC defaults themselves, and only if the
// viewer's lists differ from the new ones. The first run just records them.
const SEEN_KEY = 'lastSeenCcDefaults';
const open = ref(false);

onMounted(() => {
    const now = ccDefaultsFingerprint();
    let last: string | null = null;
    try { last = settingsStorage.getItem(SEEN_KEY); } catch { /* unavailable */ }
    if (last !== null && last !== now && ccDiffersFromDefaults()) open.value = true;
    try { settingsStorage.setItem(SEEN_KEY, now); } catch { /* unavailable */ }
});

function reset() {
    resetCcToDefaults();
    open.value = false;
}
</script>

<template>
  <DDialog v-model="open" title="CC 預設已更新" :width="460">
    <div class="msg">這一版更新了 CC 的預設清單，你目前的 BOSS、自身或技能圖表 CC 與新的預設不同。要換成新的預設嗎？</div>
    <div class="msg dim">（會覆蓋你目前的這三份清單）</div>
    <template #actions>
      <DButton data-keep @click="open = false">保留目前的</DButton>
      <DButton variant="primary" data-reset @click="reset">換成新預設</DButton>
    </template>
  </DDialog>
</template>

<style scoped>
.msg { line-height: 1.6; }
.dim { color: var(--c-text-dim); font-size: var(--fs-sm); }
</style>

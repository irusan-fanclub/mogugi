<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { DISCORD_LIMIT, encodeShare, shareFileName } from '@/lib/overlayShareCodec';
import { downloadText } from '@/lib/csvExport';
import { overlaySettings } from '../../overlay/overlayLink';
import { useOverlayState } from '../../overlay/useOverlayState';
import DDialog from '../../ui/DDialog.vue';
import DButton from '../../ui/DButton.vue';
import DTextarea from '../../ui/DTextarea.vue';

const open = defineModel<boolean>({ default: false });
const { state } = useOverlayState();

const text = ref('');
const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;

const count = computed(() => text.value.length.toLocaleString('en-US'));
const tooLong = computed(() => text.value.length > DISCORD_LIMIT);

watch(open, async v => {
    if (!v) { copied.value = false; clearTimeout(timer); return; }
    text.value = '';
    text.value = await encodeShare(overlaySettings.value, state.value?.layout);
}, { immediate: true });

async function copy() {
    try {
        await navigator.clipboard.writeText(text.value);
    } catch {
        return;
    }
    copied.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => { copied.value = false; }, 2000);
}

const save = () => downloadText(shareFileName(new Date()), text.value);
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <DDialog v-model="open" title="匯出 overlay 設定" :width="520">
    <DTextarea :model-value="text" :rows="4" readonly class="share-text" />
    <div class="meta"><span>{{ count }} 字</span><span>包含：9 個大區的設定、所有區塊的位置</span></div>
    <div v-if="tooLong" class="warn" data-share-warn>
      <i class="mdi mdi-alert-outline" />
      {{ count }} 字，超過 Discord 單則訊息上限；直接貼上會變成 message.txt 附件，對方用「從檔案匯入」即可
    </div>
    <div class="hint">不包含：快捷鍵、語音選用的聲音</div>
    <template #actions>
      <DButton :disabled="!text" @click="save"><i class="mdi mdi-content-save-outline" />存成檔案</DButton>
      <DButton variant="primary" :disabled="!text" @click="copy">
        <template v-if="copied"><i class="mdi mdi-check" />已複製</template>
        <template v-else><i class="mdi mdi-content-copy" />複製文字</template>
      </DButton>
    </template>
  </DDialog>
</template>

<style scoped>
.share-text :deep(textarea) { height: 88px !important; overflow: auto; font-family: Consolas, monospace; font-size: var(--fs-sm); word-break: break-all; }
.meta { display: flex; gap: var(--space-5); margin-top: var(--space-3); font-size: var(--fs-sm); color: var(--c-text-dim); }
.hint { margin-top: var(--space-3); font-size: var(--fs-sm); color: var(--c-text-dim); }
.warn { margin-top: var(--space-3); font-size: var(--fs-sm); color: var(--c-warn); }
</style>

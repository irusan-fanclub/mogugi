<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BackendSession } from '@/lib/backendSession';
import TrayHint from './TrayHint.vue';
import DButton from '../ui/DButton.vue';
import DDialog from '../ui/DDialog.vue';
import { useToast } from '../ui/useToast';

const props = defineProps<{ session: BackendSession }>();
const toast = useToast();

// sessionReset notices are transient: toast, not a dialog.
watch(() => props.session.notice.value, n => { if (n) toast.show(n.text, 4000); });

// Destructured so the ref write is not flagged as a prop mutation.
const { messageBox } = props.session;
const boxOpen = computed({
    get: () => messageBox.value !== null,
    set: (v: boolean) => { if (!v) messageBox.value = null; },
});
// Keeps the text on screen while the dialog is closing.
const boxText = ref('');
watch(() => props.session.messageBox.value, v => { if (v !== null) boxText.value = v; }, { immediate: true });
</script>

<template>
  <DDialog v-model="boxOpen" title="訊息">
    <div class="box-text">{{ boxText }}</div>
    <template #actions>
      <DButton variant="primary" @click="boxOpen = false">確定</DButton>
    </template>
  </DDialog>

  <TrayHint />
</template>

<style scoped>
.box-text { white-space: pre-wrap; }
</style>

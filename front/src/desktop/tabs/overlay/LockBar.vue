<script setup lang="ts">
import DButton from '../../ui/DButton.vue';
import HotkeyField from './HotkeyField.vue';

withDefaults(defineProps<{
    locked: boolean; hotkey: string; hotkeyError: string;
    /** null until the desktop shell reports it (e.g. in a plain browser). */
    elevated?: boolean | null; elevateError?: string;
    hidden?: boolean; visibleHotkey?: string; visibleHotkeyError?: string;
}>(), { elevated: null, elevateError: '', hidden: false, visibleHotkey: '', visibleHotkeyError: '' });
defineEmits<{
    setLocked: [locked: boolean]; setHotkey: [hotkey: string]; restartElevated: [];
    setHidden: [hidden: boolean]; setVisibleHotkey: [hotkey: string];
}>();
</script>

<template>
  <div class="lockbar">
    <div class="row">
      <i class="mdi" :class="locked ? 'mdi-lock' : 'mdi-lock-open-variant'" />
      <span class="status">{{ locked ? '已鎖定（滑鼠穿透）' : '已解鎖（編輯版面）' }}</span>
      <span class="grow" />
      <span class="dim">快捷鍵</span>
      <HotkeyField :hotkey="hotkey" @set-hotkey="$emit('setHotkey', $event)" />
      <DButton v-if="locked" @click="$emit('setLocked', false)">解鎖以編輯版面</DButton>
      <DButton v-else variant="primary" @click="$emit('setLocked', true)">鎖定</DButton>
    </div>
    <div v-if="hotkeyError" class="err" data-hotkey-error>{{ hotkeyError }}</div>
    <div class="row second" data-visibility>
      <i class="mdi" :class="hidden ? 'mdi-eye-off-outline' : 'mdi-eye-outline'" />
      <span class="status">{{ hidden ? '已隱藏全部 overlay' : '顯示中' }}</span>
      <span class="grow" />
      <span class="dim">快捷鍵</span>
      <HotkeyField :hotkey="visibleHotkey" @set-hotkey="$emit('setVisibleHotkey', $event)" />
      <DButton v-if="hidden" variant="primary" @click="$emit('setHidden', false)">顯示</DButton>
      <DButton v-else @click="$emit('setHidden', true)">隱藏</DButton>
    </div>
    <div v-if="visibleHotkeyError" class="err" data-visible-hotkey-error>{{ visibleHotkeyError }}</div>
    <div v-if="elevated === false" class="warn" data-not-elevated>
      <i class="mdi mdi-shield-alert-outline" />
      <span class="grow">遊戲以系統管理員身分執行，mogugi 也需要以系統管理員身分執行，快捷鍵才能在遊戲中使用。</span>
      <DButton size="sm" data-restart-elevated @click="$emit('restartElevated')">以系統管理員重新啟動</DButton>
    </div>
    <div v-if="elevated === false && elevateError" class="err" data-elevate-error>{{ elevateError }}</div>
  </div>
</template>

<style scoped>
.lockbar { padding: var(--space-3) var(--space-4); border-bottom: 1px solid var(--c-line); }
.row { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.second { margin-top: var(--space-2); }
.status { font-size: var(--fs-md); }
.grow { flex: 1; }
.dim { color: var(--c-text-dim); font-size: var(--fs-sm); }
.err { margin-top: var(--space-2); color: var(--c-err); font-size: var(--fs-sm); }
.warn { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-2); color: var(--c-warn); font-size: var(--fs-sm); }
</style>

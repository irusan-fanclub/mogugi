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
    <div class="grid">
      <span class="status">
        <i class="mdi" :class="locked ? 'mdi-lock' : 'mdi-lock-open-variant'" />
        {{ locked ? '已鎖定（滑鼠穿透）' : '已解鎖（編輯版面）' }}
      </span>
      <HotkeyField :hotkey="hotkey" title="鎖定快捷鍵" @set-hotkey="$emit('setHotkey', $event)" />
      <span class="btn">
        <DButton v-if="locked" @click="$emit('setLocked', false)">解鎖以編輯版面</DButton>
        <DButton v-else variant="primary" @click="$emit('setLocked', true)">鎖定</DButton>
      </span>
      <div v-if="$slots.top" class="side"><slot name="top" /></div>
      <span class="status" data-visibility>
        <i class="mdi" :class="hidden ? 'mdi-eye-off-outline' : 'mdi-eye-outline'" />
        {{ hidden ? '已隱藏全部 overlay' : '顯示中' }}
      </span>
      <HotkeyField :hotkey="visibleHotkey" title="顯示／隱藏快捷鍵" @set-hotkey="$emit('setVisibleHotkey', $event)" />
      <span class="btn" data-visibility-btn>
        <DButton v-if="hidden" variant="primary" @click="$emit('setHidden', false)">顯示</DButton>
        <DButton v-else @click="$emit('setHidden', true)">隱藏</DButton>
      </span>
      <div v-if="$slots.bottom" class="side"><slot name="bottom" /></div>
    </div>
    <div v-if="hotkeyError" class="err" data-hotkey-error>{{ hotkeyError }}</div>
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
.lockbar { padding: var(--space-2) var(--space-4); border-bottom: 1px solid var(--c-line); }
/* Two rows sharing columns so both hotkeys line up; slots fill the right end of each row. */
.grid { display: grid; grid-template-columns: auto auto auto 1fr; align-items: center; gap: var(--space-2) var(--space-3); }
.btn { grid-column: 3; }
.side { grid-column: 4; display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-3); }
.status { display: flex; align-items: center; gap: var(--space-2); font-size: var(--fs-md); }
.grow { flex: 1; }
.dim { color: var(--c-text-dim); font-size: var(--fs-sm); }
.err { margin-top: var(--space-2); color: var(--c-err); font-size: var(--fs-sm); }
.warn { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-2); color: var(--c-warn); font-size: var(--fs-sm); }
</style>

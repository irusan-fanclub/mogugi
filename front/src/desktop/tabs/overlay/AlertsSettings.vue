<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { condNameMap } from '@/store';
import { ccName } from '@/lib/util';
import { fillMessage } from '@/lib/alertRules';
import type { AlertKind, AlertRule, AlertsOverlaySettings, SizeStep, VoiceSettings } from '@/lib/overlaySettings';
import { createSpeechQueue } from '@/overlay/speechQueue';
import { overlaySettings, updateOverlaySettings } from '../../overlay/overlayLink';
import DSegmented from '../../ui/DSegmented.vue';
import DSwitch from '../../ui/DSwitch.vue';
import DButton from '../../ui/DButton.vue';
import DIconButton from '../../ui/DIconButton.vue';
import DSelect from '../../ui/DSelect.vue';
import OpacityRange from './OpacityRange.vue';
import AlertRuleEditor from './AlertRuleEditor.vue';
import { DEFAULT_CC_ID, ruleSummary } from './ruleSummary';

const SIZES = [
    { value: 's', label: '小' },
    { value: 'm', label: '中' },
    { value: 'l', label: '大' },
] as const;

const setAlerts = (mut: (a: AlertsOverlaySettings) => void) => updateOverlaySettings(s => mut(s.alerts));
const setVoice = (mut: (v: VoiceSettings) => void) => updateOverlaySettings(s => mut(s.voice));

const nameOf = (id: number) => ccName(condNameMap.value, id);
const rules = computed(() => overlaySettings.value.rules);

let counter = 0;
const newId = () => typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `r${Date.now().toString(36)}${(counter++).toString(36)}`;

const editing = ref<string | null>(null);
const addRule = () => {
    const rule: AlertRule = {
        id: newId(), enabled: true, kind: 'countdown', target: 'self', ccId: DEFAULT_CC_ID, times: [10], every: 30,
        conds: [], join: 'and', text: true, textMessage: '', voice: true, voiceMessage: '', textKeep: 5,
        dismiss: { condFails: false, ccEnds: false, replaced: false },
    };
    updateOverlaySettings(s => { s.rules.push(rule); });
    editing.value = rule.id;
};
const patchRule = (rule: AlertRule) =>
    updateOverlaySettings(s => { s.rules = s.rules.map(r => r.id === rule.id ? rule : r); });
const removeRule = (id: string) => {
    updateOverlaySettings(s => { s.rules = s.rules.filter(r => r.id !== id); });
    if (editing.value === id) editing.value = null;
};

const voices = ref<SpeechSynthesisVoice[]>([]);
const synth = typeof speechSynthesis !== 'undefined' ? speechSynthesis : null;
const readVoices = () => {
    const all = synth?.getVoices() ?? [];
    voices.value = [...all].sort((a, b) =>
        Number(b.lang.startsWith('zh')) - Number(a.lang.startsWith('zh')));
};
onMounted(() => {
    readVoices();
    synth?.addEventListener?.('voiceschanged', readVoices);
});
const queue = createSpeechQueue(synth, () => Date.now());
onBeforeUnmount(() => {
    synth?.removeEventListener?.('voiceschanged', readVoices);
    queue.cancel();
});
const voiceItems = computed(() => [
    { value: '', title: '預設（中文）' },
    ...voices.value.map(v => ({ value: v.name, title: `${v.name} (${v.lang})` })),
]);
const preview = (message: string, ccId: number, kind: AlertKind = 'countdown') => {
    queue.cancel();
    queue.say(fillMessage(message, { sec: 15, name: '測試', cc: nameOf(ccId) }, kind), overlaySettings.value.voice);
};
</script>

<template>
  <div class="settings">
    <div class="setting">
      <div class="lbl">透明度</div>
      <OpacityRange
        data-alerts-opacity
        :model-value="overlaySettings.alerts.opacity"
        @update:model-value="v => setAlerts(a => { a.opacity = v; })"
      />
    </div>
    <div class="setting">
      <div class="lbl">字級</div>
      <DSegmented
        :model-value="overlaySettings.alerts.fontSize"
        :options="[...SIZES]"
        @update:model-value="(v: SizeStep) => setAlerts(a => { a.fontSize = v; })"
      />
    </div>

    <section class="block" data-voice>
      <div class="title">語音</div>
      <div class="setting">
        <div class="lbl">語音</div>
        <DSelect
          class="voice-select"
          :model-value="overlaySettings.voice.voiceName"
          :items="voiceItems"
          @update:model-value="v => setVoice(x => { x.voiceName = v; })"
        />
      </div>
      <div class="setting">
        <div class="lbl">語速</div>
        <span class="range">
          <input
            data-voice-rate type="range" min="0.6" max="1.8" step="0.1" aria-label="語速"
            :value="overlaySettings.voice.rate"
            @input="e => setVoice(x => { x.rate = Number((e.target as HTMLInputElement).value); })"
          >
          <span class="val">{{ overlaySettings.voice.rate.toFixed(1) }}x</span>
        </span>
      </div>
      <div class="setting">
        <div class="lbl">音量</div>
        <span class="range">
          <input
            data-voice-volume type="range" min="0" max="100" step="1" aria-label="音量"
            :value="overlaySettings.voice.volume"
            @input="e => setVoice(x => { x.volume = Number((e.target as HTMLInputElement).value); })"
          >
          <span class="val">{{ overlaySettings.voice.volume }}%</span>
        </span>
      </div>
      <div class="setting">
        <div class="lbl">靜音</div>
        <DSwitch
          data-voice-muted
          :model-value="overlaySettings.voice.muted"
          @update:model-value="v => setVoice(x => { x.muted = v; })"
        />
      </div>
      <div class="setting">
        <div class="lbl" />
        <DButton size="sm" data-voice-preview @click="preview('', DEFAULT_CC_ID)">試聽</DButton>
      </div>
    </section>

    <section class="block" data-rules>
      <div class="head">
        <span class="title">提醒規則</span>
        <span class="grow" />
        <DButton size="sm" data-add-rule @click="addRule">新增規則</DButton>
      </div>
      <div v-if="rules.length === 0" class="note" data-no-rules>尚未設定任何規則</div>
      <div v-for="r in rules" :key="r.id" class="rule" data-rule>
        <div class="rrow">
          <DSwitch
            :model-value="r.enabled"
            @update:model-value="(v: boolean) => patchRule({ ...r, enabled: v })"
          />
          <span class="summary" :class="{ off: !r.enabled }" data-rule-summary>{{ ruleSummary(r, nameOf) }}</span>
          <DIconButton
            :icon="editing === r.id ? 'mdi-chevron-up' : 'mdi-pencil-outline'"
            title="編輯"
            data-rule-edit
            @click="editing = editing === r.id ? null : r.id"
          />
          <DIconButton icon="mdi-close" title="刪除" data-rule-remove @click="removeRule(r.id)" />
        </div>
        <AlertRuleEditor
          v-if="editing === r.id"
          :rule="r"
          @update:rule="patchRule"
          @preview="preview(r.voiceMessage || r.textMessage, r.ccId, r.kind)"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings { display: flex; flex-direction: column; gap: var(--space-4); }
.setting { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); }
.block { display: flex; flex-direction: column; gap: var(--space-3); }
.head { display: flex; align-items: center; gap: var(--space-3); }
.grow { flex: 1; }
.title { font-size: var(--fs-md); font-weight: 600; }
.voice-select { width: 240px; }
.range { display: inline-flex; align-items: center; gap: var(--space-3); }
.range input { width: 160px; accent-color: var(--c-accent); }
.val { width: 3.5em; text-align: right; color: var(--c-text-dim); font-size: var(--fs-sm); }
.note { color: var(--c-text-dim); font-size: var(--fs-sm); }
.rule { border: 1px solid var(--c-line); }
.rrow { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3); }
.summary { flex: 1; min-width: 0; font-size: var(--fs-sm); }
.summary.off { color: var(--c-text-dim); }
</style>

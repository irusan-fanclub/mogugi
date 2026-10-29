<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AlertCond, AlertKind, AlertRule, AlertTarget } from '@/lib/overlaySettings';
import DSegmented from '../../ui/DSegmented.vue';
import DCheckbox from '../../ui/DCheckbox.vue';
import DTextField from '../../ui/DTextField.vue';
import DNumberField from '../../ui/DNumberField.vue';
import DButton from '../../ui/DButton.vue';
import DIconButton from '../../ui/DIconButton.vue';
import CcPicker from './CcPicker.vue';
import { DEFAULT_CC_ID, parseTimes } from './ruleSummary';

const props = defineProps<{ rule: AlertRule }>();
const emit = defineEmits<{ 'update:rule': [rule: AlertRule]; preview: [] }>();

const KINDS: { value: AlertKind; label: string }[] = [
    { value: 'countdown', label: '倒數提醒' },
    { value: 'periodic', label: '定時檢查' },
];
const TARGETS: { value: AlertTarget; label: string }[] = [
    { value: 'boss', label: 'BOSS' },
    { value: 'self', label: '自身' },
    { value: 'all', label: '全隊（包含自己）' },
    { value: 'party', label: '其他隊友' },
];
const COND_MODES = [
    { value: 'present', label: '有' },
    { value: 'absent', label: '沒有' },
] as const;
const JOINS = [
    { value: 'and', label: '全部成立（且）' },
    { value: 'or', label: '任一成立（或）' },
] as const;

const patch = (p: Partial<AlertRule>) => emit('update:rule', { ...props.rule, ...p });
const isCountdown = computed(() => props.rule.kind === 'countdown');

const setKind = (kind: AlertKind) => {
    if (kind === 'periodic') patch({ kind, ccId: 0, times: [] });
    else patch({ kind, ccId: props.rule.ccId || DEFAULT_CC_ID, times: props.rule.times.length ? props.rule.times : [10] });
};

const timesText = ref(props.rule.times.join(', '));
watch(() => [props.rule.id, props.rule.kind], () => { timesText.value = props.rule.times.join(', '); });
const onTimes = (text: string) => {
    timesText.value = text;
    const t = parseTimes(text);
    if (t.length > 0) patch({ times: t });
};
const tidyTimes = () => { timesText.value = props.rule.times.join(', '); };

const setConds = (conds: AlertCond[]) => patch({ conds });
const addCond = () => setConds([...props.rule.conds, { mode: 'absent', ccId: props.rule.ccId || DEFAULT_CC_ID }]);
const editCond = (i: number, p: Partial<AlertCond>) =>
    setConds(props.rule.conds.map((c, j) => j === i ? { ...c, ...p } : c));
const removeCond = (i: number) => setConds(props.rule.conds.filter((_, j) => j !== i));

const patchDismiss = (p: Partial<AlertRule['dismiss']>) => patch({ dismiss: { ...props.rule.dismiss, ...p } });
const placeholders = computed(() => isCountdown.value ? '{名字}、{CC}、{秒}' : '{名字}');
const defaultSentence = computed(() => isCountdown.value ? '{名字} {CC} 剩 {秒} 秒' : '{名字} 條件成立');
</script>

<template>
  <div class="editor" data-rule-editor>
    <div class="field">
      <span class="lbl">類型</span>
      <DSegmented :model-value="rule.kind" :options="KINDS" @update:model-value="setKind" />
    </div>
    <div class="field">
      <span class="lbl">對象</span>
      <DSegmented :model-value="rule.target" :options="TARGETS" @update:model-value="(v: AlertTarget) => patch({ target: v })" />
    </div>
    <template v-if="isCountdown">
      <div class="field">
        <span class="lbl">CC</span>
        <CcPicker :model-value="rule.ccId" @update:model-value="(v: number) => patch({ ccId: v })" />
      </div>
      <div class="field">
        <span class="lbl">時間點</span>
        <DTextField
          data-rule-times
          :model-value="timesText"
          placeholder="25, 15, 5"
          hint="剩餘秒數，逗號分隔"
          @update:model-value="onTimes"
          @blur="tidyTimes"
        />
      </div>
    </template>
    <div v-else class="field">
      <span class="lbl">間隔</span>
      <span class="inline">
        每
        <DNumberField
          data-rule-every
          class="num"
          :min="1"
          :max="3600"
          :model-value="rule.every"
          @update:model-value="(v: number) => patch({ every: Math.round(v) })"
        />
        秒檢查一次
      </span>
    </div>
    <div class="field">
      <span class="lbl">條件</span>
      <div class="conds">
        <div v-for="(c, i) in rule.conds" :key="i" class="cond" data-cond-row>
          <DSegmented
            :model-value="c.mode"
            :options="[...COND_MODES]"
            @update:model-value="(v: AlertCond['mode']) => editCond(i, { mode: v })"
          />
          <CcPicker :model-value="c.ccId" @update:model-value="(v: number) => editCond(i, { ccId: v })" />
          <DIconButton icon="mdi-close" title="移除條件" data-cond-remove @click="removeCond(i)" />
        </div>
        <DSegmented
          v-if="rule.conds.length >= 2"
          data-join
          :model-value="rule.join"
          :options="[...JOINS]"
          @update:model-value="(v: AlertRule['join']) => patch({ join: v })"
        />
        <DButton size="sm" data-cond-add @click="addCond">新增條件</DButton>
      </div>
    </div>
    <div class="field">
      <span class="lbl">提醒方式</span>
      <div class="how">
        <DCheckbox label="文字" :model-value="rule.text" @update:model-value="(v: boolean) => patch({ text: v })" />
        <DCheckbox label="語音" :model-value="rule.voice" @update:model-value="(v: boolean) => patch({ voice: v })" />
        <span v-if="isCountdown" class="hint">都不勾：只把圖示轉紅</span>
      </div>
    </div>
    <div v-if="rule.text" class="field">
      <span class="lbl">文字內容</span>
      <DTextField
        data-rule-message
        :model-value="rule.textMessage"
        :placeholder="defaultSentence"
        :hint="`可用 ${placeholders}；留空用預設句`"
        @update:model-value="(v: string) => patch({ textMessage: v })"
      />
    </div>
    <div v-if="rule.voice" class="field">
      <span class="lbl">語音內容</span>
      <DTextField
        data-rule-voice-message
        :model-value="rule.voiceMessage"
        placeholder="留空念文字內容"
        :hint="`可用 ${placeholders}`"
        @update:model-value="(v: string) => patch({ voiceMessage: v })"
      />
    </div>
    <div v-if="rule.text" class="field">
      <span class="lbl">文字消失</span>
      <div class="dismiss">
        <span class="inline">
          <DNumberField
            data-rule-keep
            class="num"
            :min="1"
            :max="600"
            :model-value="rule.textKeep"
            @update:model-value="(v: number) => patch({ textKeep: Math.round(v) })"
          />
          秒後消失
        </span>
        <DCheckbox
          label="條件不再成立時"
          :model-value="rule.dismiss.condFails"
          @update:model-value="(v: boolean) => patchDismiss({ condFails: v })"
        />
        <DCheckbox
          v-if="isCountdown"
          label="監測的 CC 結束時"
          :model-value="rule.dismiss.ccEnds"
          @update:model-value="(v: boolean) => patchDismiss({ ccEnds: v })"
        />
        <DCheckbox
          label="同規則下一則出現時取代"
          :model-value="rule.dismiss.replaced"
          @update:model-value="(v: boolean) => patchDismiss({ replaced: v })"
        />
      </div>
    </div>
    <div class="field">
      <span class="lbl" />
      <DButton size="sm" data-rule-preview @click="emit('preview')">試聽</DButton>
    </div>
  </div>
</template>

<style scoped>
.editor { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-3) var(--space-4); background: var(--c-surface-2); }
.field { display: flex; align-items: flex-start; gap: var(--space-4); }
.lbl { width: 5em; flex: none; padding-top: 4px; color: var(--c-text-dim); font-size: var(--fs-sm); }
.field > :not(.lbl) { min-width: 0; }
.conds { display: flex; flex-direction: column; gap: var(--space-2); align-items: flex-start; }
.cond { display: flex; align-items: flex-start; gap: var(--space-3); }
.inline { display: inline-flex; align-items: center; gap: var(--space-3); }
.num { width: 6em; }
.dismiss { display: flex; flex-direction: column; gap: var(--space-2); align-items: flex-start; }
.how { display: flex; align-items: center; gap: var(--space-4); }
.hint { color: var(--c-text-dim); font-size: var(--fs-xs); }
</style>

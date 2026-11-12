<script setup lang="ts">
import { computed } from 'vue';
import type { SectionLook } from '@/lib/overlayFrames';
import {
    cleanTitleText, ICON_SIZE_PX, TITLE_MAX,
    type Arrange, type CcLook, type CcNames, type CooldownLook, type GapMode, type SectionId,
} from '@/lib/overlaySections';
import { COMPONENT_NAMES } from '@/lib/overlayComponents';
import { overlaySettings } from '../../overlay/overlayLink';
import DCheckbox from '../../ui/DCheckbox.vue';
import DSegmented from '../../ui/DSegmented.vue';
import PanelBgField from './PanelBgField.vue';
import SizeField, { type SizeValue } from './SizeField.vue';

// `follow`: null on the main frame; on a pulled frame true = same look as the main frame.
const props = defineProps<{ look: SectionLook; section: SectionId; follow: boolean | null; mainTitle?: string }>();
const emit = defineEmits<{ 'update:look': [v: SectionLook]; 'update:follow': [v: boolean] }>();

const own = computed(() => props.follow !== true);
const isCooldown = computed(() => props.section === 'cooldown');
const cc = computed(() => props.look as CcLook);
const patch = (p: Record<string, unknown>) => emit('update:look', { ...props.look, ...p } as SectionLook);

const FOLLOW = computed(() => [
    { value: 'follow', label: `跟『${props.mainTitle ?? COMPONENT_NAMES[props.section]}』一樣` }, { value: 'own', label: '自訂' },
]);
const NAMES = computed(() => props.section === 'ccParty'
    ? [{ value: 'label', label: '文字' }, { value: 'member', label: '隊友名' }, { value: 'none', label: '無' }]
    : [{ value: 'label', label: '文字' }, { value: 'none', label: '無' }]);
const CD_NAMES = [{ value: 'on', label: '玩家名稱' }, { value: 'off', label: '不顯示' }];
const ARRANGE = [{ value: 'flow', label: '平鋪' }, { value: 'byMember', label: '依隊友排列' }];
const GAP = [{ value: 'keep', label: '留空對齊' }, { value: 'pack', label: '往左補齊' }];

function setText(e: Event) {
    if ((e as InputEvent).isComposing) return;
    const el = e.target as HTMLInputElement;
    const v = cleanTitleText(el.value);
    el.value = v;
    patch({ titleText: v });
}
</script>

<template>
  <div v-if="follow !== null" class="ovs-field">
    <span class="ovs-lbl">外觀</span>
    <DSegmented :model-value="follow ? 'follow' : 'own'" :options="FOLLOW" data-follow @update:model-value="(v: string) => emit('update:follow', v === 'follow')" />
  </div>
  <div class="ovs-field">
    <span class="ovs-lbl">標題</span>
    <DCheckbox label="顯示" :model-value="look.title" data-title-on @update:model-value="v => patch({ title: v })" />
    <input
      class="ovs-txt" :maxlength="TITLE_MAX * 2" :value="look.titleText" :placeholder="COMPONENT_NAMES[section]" data-title-text
      @change="setText" @compositionend="setText"
    >
  </div>
  <template v-if="own">
    <div class="ovs-field">
      <span class="ovs-lbl">圖示大小</span>
      <SizeField
        :model-value="{ size: look.size, px: look.px }" :presets="ICON_SIZE_PX" :min="16" :max="96"
        @update:model-value="(v: SizeValue) => patch({ size: v.size, px: v.px })"
      />
    </div>
    <div v-if="isCooldown" class="ovs-field">
      <span class="ovs-lbl">顯示名字</span>
      <DSegmented :model-value="(look as CooldownLook).names ? 'on' : 'off'" :options="CD_NAMES" data-names @update:model-value="(v: string) => patch({ names: v === 'on' })" />
    </div>
    <div v-else-if="section !== 'burst'" class="ovs-field">
      <span class="ovs-lbl">圖示下方</span>
      <DSegmented :model-value="cc.names" :options="NAMES" data-names @update:model-value="(v: string) => patch({ names: v as CcNames })" />
    </div>
    <template v-if="section === 'ccParty' || isCooldown">
      <div class="ovs-field">
        <span class="ovs-lbl">排列</span>
        <DSegmented :model-value="look.arrange" :options="ARRANGE" data-arrange @update:model-value="(v: string) => patch({ arrange: v as Arrange })" />
      </div>
      <div v-if="look.arrange === 'byMember'" class="ovs-field">
        <span class="ovs-lbl">用不到的格子</span>
        <DSegmented :model-value="look.gap" :options="GAP" data-gap @update:model-value="(v: string) => patch({ gap: v as GapMode })" />
      </div>
    </template>
    <div v-if="!isCooldown && section !== 'burst'" class="ovs-field">
      <span class="ovs-lbl">平常透明度</span>
      <input
        type="range" min="10" max="100" step="5" :value="cc.dim" data-dim aria-label="平常透明度"
        @input="e => patch({ dim: Number((e.target as HTMLInputElement).value) })"
      >
      <span class="ovs-dim">{{ cc.dim }}%</span>
    </div>
    <PanelBgField :model-value="look.bg" :fallback="overlaySettings.general.bg" @update:model-value="v => patch({ bg: v })" />
  </template>
</template>

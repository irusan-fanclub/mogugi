<script setup lang="ts">
import { computed, ref } from 'vue';
import { playerSkillIds, skillNameMap } from '@/store';
import { ARCANA_BY_SKILL, ARCANA_NAMES } from '@/lib/arcanaTable';
import {
    defaultCooldownItem, defaultCooldownSection, ICON_SIZE_PX, itemKey,
    type CooldownItem, type CooldownSection, type CooldownWho,
} from '@/lib/overlaySections';
import { overlaySettings, updateOverlaySettings } from '../../overlay/overlayLink';
import DButton from '../../ui/DButton.vue';
import DCheckbox from '../../ui/DCheckbox.vue';
import DSegmented from '../../ui/DSegmented.vue';
import ArcanaChips from './ArcanaChips.vue';
import IconButton from './IconButton.vue';
import ItemPicker, { type PickerItem, type PickerMark } from './ItemPicker.vue';
import ItemRow from './ItemRow.vue';
import PanelBgField from './PanelBgField.vue';
import SizeField, { type SizeValue } from './SizeField.vue';
import SoonChecks from './SoonChecks.vue';
import { useSectionLayout } from './sectionLayout';

const WHO: { value: CooldownWho; label: string }[] = [
    { value: 'self', label: '自己' }, { value: 'party', label: '隊伍' }, { value: 'all', label: '全部' },
];
const NAMES = [{ value: 'on', label: '玩家名稱' }, { value: 'off', label: '不顯示' }] as const;
const ARCANA_SKILLS = { lo: 59000, hi: 59199 };

const sec = computed(() => overlaySettings.value.cooldown);
const look = computed(() => sec.value.look);
const setSec = (mut: (s: CooldownSection) => void) => updateOverlaySettings(s => mut(s.cooldown));
const setItem = (id: number, mut: (it: CooldownItem) => void) => setSec(s => {
    const it = s.items.find(i => i.skillId === id);
    if (it) mut(it);
});
const setSize = (v: SizeValue) => setSec(s => { s.look.size = v.size; s.look.px = v.px; });

const { isSolo, recall, inOrder, forget } = useSectionLayout(() => 'cooldown');
const rows = computed(() => inOrder(sec.value.items.map(itemKey)).map(k => sec.value.items.find(i => itemKey(i) === k)!));
const openId = ref<number | null>(null);

const icon = (id: number) => `/icons/skill/${id}.png`;
const nameOf = (id: number) => skillNameMap.value[id] ?? `技能 ${id}`;
// A default skill goes back to its preset (cooldown, start CC), any other to the plain default.
const defaultOf = (id: number) => defaultCooldownSection().items.find(i => i.skillId === id) ?? defaultCooldownItem(id);

function add(id: number) {
    setSec(s => { if (!s.items.some(i => i.skillId === id)) s.items.push(defaultOf(id)); });
    openId.value = id;
}
const reset = (id: number) => setSec(s => {
    const i = s.items.findIndex(x => x.skillId === id);
    if (i >= 0) s.items[i] = defaultOf(id);
});
function remove(it: CooldownItem) {
    setSec(s => { s.items = s.items.filter(x => x.skillId !== it.skillId); });
    forget(itemKey(it));
    if (openId.value === it.skillId) openId.value = null;
}
function setSecs(id: number, raw: string) {
    const n = Math.round(Number(raw));
    if (Number.isFinite(n) && n >= 1) setItem(id, it => { it.cooldownSec = Math.min(3600, n); });
}

const picking = ref(false);
const filter = ref<'all' | 'arcana'>('all');
const FILTERS = [{ value: 'all', label: '全部' }, { value: 'arcana', label: '秘法技能' }];
const skills = computed((): PickerItem[] => Object.entries(skillNameMap.value)
    .map(([id, name]) => ({ id: Number(id), name }))
    // An old db cannot tell player skills apart: list them all rather than none.
    .filter(s => playerSkillIds.value.size === 0 || playerSkillIds.value.has(s.id))
    .filter(s => filter.value === 'all' || (s.id >= ARCANA_SKILLS.lo && s.id <= ARCANA_SKILLS.hi))
    .sort((a, b) => a.id - b.id)
    .map(s => {
        const a = ARCANA_BY_SKILL[s.id];
        return { ...s, sub: a ? ARCANA_NAMES[a] : String(s.id) };
    }));
const markOf = (id: number): PickerMark => sec.value.items.some(i => i.skillId === id) ? 'added' : '';
const onPick = (id: number) => { picking.value = false; add(id); };
</script>

<template>
  <div class="ovs-page" data-cd-page>
    <h2>技能冷卻</h2>
    <div class="ovs-box">
      <h3>外觀<IconButton kind="reset" data-reset-look @fire="setSec(s => { s.look = defaultCooldownSection().look; })" /></h3>
      <div class="ovs-field">
        <span class="ovs-lbl">圖示大小</span>
        <SizeField :model-value="{ size: look.size, px: look.px }" :presets="ICON_SIZE_PX" :min="16" :max="96" @update:model-value="setSize" />
      </div>
      <div class="ovs-field">
        <span class="ovs-lbl">圖示下方</span>
        <DSegmented
          :model-value="look.names ? 'on' : 'off'" :options="[...NAMES]" data-names
          @update:model-value="(v: string) => setSec(s => { s.look.names = v === 'on'; })"
        />
      </div>
      <div class="ovs-field">
        <span class="ovs-lbl">標題</span>
        <DCheckbox label="顯示「技能冷卻」" :model-value="look.title" data-title-on @update:model-value="v => setSec(s => { s.look.title = v; })" />
      </div>
      <PanelBgField :model-value="look.bg" :fallback="overlaySettings.general.bg" @update:model-value="v => setSec(s => { s.look.bg = v; })" />
    </div>

    <div class="ovs-box">
      <h3>監測技能</h3>
      <ItemRow
        v-for="it in rows" :key="it.skillId"
        :item-key="itemKey(it)" :icon="icon(it.skillId)" :name="nameOf(it.skillId)" :solo="isSolo(itemKey(it))"
        :enabled="it.enabled" :open="openId === it.skillId"
        @toggle="openId = openId === it.skillId ? null : it.skillId"
        @reset="reset(it.skillId)" @remove="remove(it)" @recall="recall(itemKey(it))"
        @update:enabled="v => setItem(it.skillId, x => { x.enabled = v; })"
      >
        <div class="ovs-field">
          <span class="ovs-lbl">冷卻秒數</span>
          <input
            class="ovs-num" type="number" min="1" max="3600" :value="it.cooldownSec" data-cd-sec
            @change="e => setSecs(it.skillId, (e.target as HTMLInputElement).value)"
          > 秒
        </div>
        <div class="ovs-field">
          <span class="ovs-lbl">顯示對象</span>
          <DSegmented :model-value="it.who" :options="WHO" data-who @update:model-value="(v: CooldownWho) => setItem(it.skillId, x => { x.who = v; })" />
        </div>
        <div class="ovs-field">
          <span class="ovs-lbl">完成提醒</span>
          <SoonChecks />
        </div>
        <div class="ovs-field top">
          <span class="ovs-lbl">自身秘法</span>
          <ArcanaChips :model-value="it.arcana" @update:model-value="v => setItem(it.skillId, x => { x.arcana = v; })" />
        </div>
      </ItemRow>
      <DButton size="sm" data-add @click="filter = 'all'; picking = true">＋ 新增技能</DButton>
      <p class="ovs-pos">位置在「遊戲內排版編輯」調整。</p>
    </div>
    <ItemPicker
      v-if="picking" title="新增技能" :items="skills" :icon-of="icon" :mark-of="markOf"
      :sources="FILTERS" :source="filter"
      @pick="onPick" @close="picking = false" @update:source="(v: string) => filter = v === 'arcana' ? 'arcana' : 'all'"
    />
  </div>
</template>

<style scoped>
.top { align-items: flex-start; }
</style>

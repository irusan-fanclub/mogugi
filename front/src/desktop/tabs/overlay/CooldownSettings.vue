<script setup lang="ts">
import { computed, ref } from 'vue';
import { playerSkillIds, skillNameMap } from '@/store';
import { ARCANA_BY_SKILL, ARCANA_NAMES } from '@/lib/arcanaTable';
import {
    defaultCooldownItem, defaultCooldownSection, itemKey,
    type CooldownItem, type CooldownLook, type CooldownSection, type CooldownWho,
} from '@/lib/overlaySections';
import { overlaySettings, updateOverlaySettings } from '../../overlay/overlayLink';
import DButton from '../../ui/DButton.vue';
import DSegmented from '../../ui/DSegmented.vue';
import ArcanaChips from './ArcanaChips.vue';
import FrameBlock from './FrameBlock.vue';
import FrameLookFields from './FrameLookFields.vue';
import ItemPicker, { type PickerItem, type PickerMark } from './ItemPicker.vue';
import ItemRow from './ItemRow.vue';
import MoveMenu from './MoveMenu.vue';
import SoonChecks from './SoonChecks.vue';
import { useFrameBlocks, useSectionLayout } from './sectionLayout';

const WHO: { value: CooldownWho; label: string }[] = [
    { value: 'self', label: '自己' }, { value: 'party', label: '隊伍' }, { value: 'all', label: '全部' },
];
const ARCANA_SKILLS = { lo: 59000, hi: 59199 };

const sec = computed(() => overlaySettings.value.cooldown);
const look = computed(() => sec.value.look);
const setSec = (mut: (s: CooldownSection) => void) => updateOverlaySettings(s => mut(s.cooldown));
const setItem = (id: number, mut: (it: CooldownItem) => void) => setSec(s => {
    const it = s.items.find(i => i.skillId === id);
    if (it) mut(it);
});

const { forget } = useSectionLayout(() => 'cooldown');
const { blocks, toggle, onLook, onFollow, onReset, move } = useFrameBlocks(
    () => 'cooldown', () => look.value,
    l => setSec(s => { s.look = l as CooldownLook; }),
    () => setSec(s => { s.look = defaultCooldownSection().look; }),
);
const itemsOf = (keys: string[]) => keys.map(k => sec.value.items.find(i => itemKey(i) === k)).filter((i): i is CooldownItem => !!i);
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
    <FrameBlock
      v-for="f in blocks" :key="f.id"
      :title="f.title" :summary="f.summary" :open="f.open" :data-frame="f.id"
      @toggle="toggle(f.id)" @reset="onReset(f.id)"
    >
      <template #look>
        <FrameLookFields
          :look="f.look" section="cooldown" :follow="f.follow" :main-title="blocks[0].title"
          @update:look="l => onLook(f.id, l)" @update:follow="v => onFollow(f.id, v)"
        />
      </template>
      <template #items>
          <ItemRow
            v-for="it in itemsOf(f.keys)" :key="it.skillId"
            :item-key="itemKey(it)" :icon="icon(it.skillId)" :name="nameOf(it.skillId)"
            :enabled="it.enabled" :open="openId === it.skillId"
            @toggle="openId = openId === it.skillId ? null : it.skillId"
            @reset="reset(it.skillId)" @remove="remove(it)"
            @update:enabled="v => setItem(it.skillId, x => { x.enabled = v; })"
          >
            <template #move>
              <MoveMenu
                :blocks="blocks.map(b => ({ id: b.id, name: b.title }))" :current="f.id"
                :can-up="f.kind !== 'unit' && f.keys.indexOf(itemKey(it)) > 0"
                :can-down="f.kind !== 'unit' && f.keys.indexOf(itemKey(it)) < f.keys.length - 1"
                :can-new="f.kind !== 'unit'"
                @move="to => move(itemKey(it), to)"
              />
            </template>
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
        <DButton v-if="f.kind === 'section'" size="sm" data-add @click="filter = 'all'; picking = true">＋ 新增技能</DButton>
      </template>
    </FrameBlock>
    <p class="ovs-pos">位置在「遊戲內排版編輯」調整。把 icon 拉出來就會多一塊。</p>
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

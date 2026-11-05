<script setup lang="ts">
import { computed, ref } from 'vue';
import { condNameMap, region, skillNameMap } from '@/store';
import { ccIconUrl, ccName } from '@/lib/util';
import { COMPONENT_NAMES } from '@/lib/overlayComponents';
import {
    defaultCcItem, defaultCcSection, ICON_SIZE_PX, itemKey, MUSIC_CC,
    type CcItem, type CcNames, type CcSection, type CcSectionId, type IconRef,
} from '@/lib/overlaySections';
import { itemName } from '@/overlay/sectionView';
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

const props = defineProps<{ section: CcSectionId }>();
const LABEL_MAX = 6;

const sec = computed(() => overlaySettings.value[props.section]);
const look = computed(() => sec.value.look);
const lookOnly = computed(() => props.section === 'burst');
const setSec = (mut: (s: CcSection) => void) => updateOverlaySettings(s => mut(s[props.section]));
const setItem = (id: number, mut: (it: CcItem) => void) => setSec(s => {
    const it = s.items.find(i => i.id === id);
    if (it) mut(it);
});

const { isSolo, recall, inOrder, forget } = useSectionLayout(() => props.section);
const rows = computed(() => inOrder(sec.value.items.map(itemKey)).map(k => sec.value.items.find(i => itemKey(i) === k)!));
const openId = ref<number | null>(null);

const NAMES = computed((): { value: CcNames; label: string }[] => props.section === 'ccParty'
    ? [{ value: 'member', label: '隊友名稱' }, { value: 'label', label: 'CC 顯示文字' }, { value: 'none', label: '不顯示' }]
    : [{ value: 'label', label: 'CC 顯示文字' }, { value: 'none', label: '不顯示' }]);
const setSize = (v: SizeValue) => setSec(s => { s.look.size = v.size; s.look.px = v.px; });

const ccIcon = (id: number) => ccIconUrl(region.value, id);
const skillIcon = (id: number) => `/icons/skill/${id}.png`;
const iconUrl = (ic: IconRef) => ic.kind === 'cc' ? ccIcon(ic.id) : skillIcon(ic.id);
const cc = (id: number) => ccName(condNameMap.value, id);
const labelOf = (id: number) => Array.from(cc(id)).slice(0, LABEL_MAX).join('');
const nameOf = (it: CcItem) => itemName(props.section, itemKey(it), it);
const isMusic = (it: CcItem) => it.ids.some(id => MUSIC_CC.includes(id));

function add(id: number) {
    setSec(s => { if (!s.items.some(i => i.id === id)) s.items.push(defaultCcItem(props.section, id, labelOf(id))); });
    openId.value = id;
}
const reset = (id: number) => setSec(s => {
    const i = s.items.findIndex(x => x.id === id);
    if (i >= 0) s.items[i] = defaultCcItem(props.section, id, labelOf(id));
});
function remove(it: CcItem) {
    setSec(s => { s.items = s.items.filter(x => x.id !== it.id); });
    forget(itemKey(it));
    if (openId.value === it.id) openId.value = null;
}
function setLabel(id: number, e: Event) {
    if ((e as InputEvent).isComposing) return;
    const v = Array.from((e.target as HTMLInputElement).value).slice(0, LABEL_MAX).join('');
    setItem(id, it => { it.label = v; });
}
function setWarnSec(id: number, raw: string) {
    const n = Math.round(Number(raw));
    if (Number.isFinite(n) && n >= 1) setItem(id, it => { it.warnSec = Math.min(600, n); });
}

// The shared picker: a new item, an item's icon, a watched CC, the 自動延續 CC.
type PickCtx = { mode: 'add' } | { mode: 'icon' | 'alt' | 'renew'; id: number };
const pickCtx = ref<PickCtx | null>(null);
const iconSrc = ref<'cc' | 'skill'>('cc');
const ccItems = computed((): PickerItem[] => Object.keys(condNameMap.value).map(Number)
    .sort((a, b) => a - b).map(id => ({ id, name: cc(id) })));
const skillItems = computed((): PickerItem[] => Object.entries(skillNameMap.value)
    .map(([id, name]) => ({ id: Number(id), name })).sort((a, b) => a.id - b.id));
function openPicker(ctx: PickCtx) {
    if (ctx.mode === 'icon') iconSrc.value = sec.value.items.find(i => i.id === ctx.id)?.icon.kind ?? 'cc';
    pickCtx.value = ctx;
}
const picker = computed(() => {
    const c = pickCtx.value;
    if (!c) return null;
    if (c.mode === 'add') {
        return {
            title: `新增 CC（${COMPONENT_NAMES[props.section]}）`, items: ccItems.value, iconOf: ccIcon,
            markOf: (id: number): PickerMark => sec.value.items.some(i => i.id === id) ? 'added' : '',
        };
    }
    const it = sec.value.items.find(i => i.id === c.id);
    if (!it) return null;
    if (c.mode === 'icon') {
        const src = iconSrc.value;
        return {
            title: `選擇圖示（${nameOf(it)}）`, items: src === 'cc' ? ccItems.value : skillItems.value,
            iconOf: src === 'cc' ? ccIcon : skillIcon,
            markOf: (id: number): PickerMark => it.icon.kind === src && it.icon.id === id ? 'cur' : '',
            sources: [{ value: 'cc', label: 'CC' }, { value: 'skill', label: '技能' }],
        };
    }
    return {
        title: c.mode === 'alt' ? `監測 CC（${nameOf(it)}）` : `自動延續條件（${nameOf(it)}）`, items: ccItems.value, iconOf: ccIcon,
        markOf: (id: number): PickerMark => c.mode === 'alt' ? (it.ids.includes(id) ? 'added' : '') : (it.renew === id ? 'cur' : ''),
    };
});
function onPick(id: number) {
    const c = pickCtx.value;
    pickCtx.value = null;
    if (!c) return;
    if (c.mode === 'add') add(id);
    else if (c.mode === 'icon') setItem(c.id, it => { it.icon = { kind: iconSrc.value, id }; });
    else if (c.mode === 'alt') setItem(c.id, it => { if (!it.ids.includes(id)) it.ids.push(id); });
    else setItem(c.id, it => { it.renew = id; });
}
</script>

<template>
  <div class="ovs-page" :data-cc-page="section">
    <h2>{{ COMPONENT_NAMES[section] }}</h2>
    <div class="ovs-box">
      <h3>外觀<IconButton kind="reset" data-reset-look @fire="setSec(s => { s.look = defaultCcSection(section).look; })" /></h3>
      <div class="ovs-field">
        <span class="ovs-lbl">圖示大小</span>
        <SizeField :model-value="{ size: look.size, px: look.px }" :presets="ICON_SIZE_PX" :min="16" :max="96" @update:model-value="setSize" />
      </div>
      <template v-if="!lookOnly">
        <div class="ovs-field">
          <span class="ovs-lbl">圖示下方</span>
          <DSegmented :model-value="look.names" :options="NAMES" data-names @update:model-value="(v: CcNames) => setSec(s => { s.look.names = v; })" />
        </div>
        <div class="ovs-field">
          <span class="ovs-lbl">平常透明度</span>
          <input
            type="range" min="10" max="100" step="5" :value="look.dim" data-dim aria-label="平常透明度"
            @input="e => setSec(s => { s.look.dim = Number((e.target as HTMLInputElement).value); })"
          >
          <span class="ovs-dim">{{ look.dim }}%</span>
        </div>
      </template>
      <div class="ovs-field">
        <span class="ovs-lbl">標題</span>
        <DCheckbox :label="`顯示「${COMPONENT_NAMES[section]}」`" :model-value="look.title" data-title-on @update:model-value="v => setSec(s => { s.look.title = v; })" />
      </div>
      <PanelBgField :model-value="look.bg" :fallback="overlaySettings.general.bg" @update:model-value="v => setSec(s => { s.look.bg = v; })" />
    </div>

    <div v-if="!lookOnly" class="ovs-box">
      <h3>監測項目</h3>
      <ItemRow
        v-for="it in rows" :key="it.id"
        :item-key="itemKey(it)" :icon="iconUrl(it.icon)" :name="nameOf(it)" :solo="isSolo(itemKey(it))"
        :enabled="it.enabled" :open="openId === it.id"
        @toggle="openId = openId === it.id ? null : it.id"
        @reset="reset(it.id)" @remove="remove(it)" @recall="recall(itemKey(it))"
        @update:enabled="v => setItem(it.id, x => { x.enabled = v; })"
      >
        <div class="ovs-field">
          <span class="ovs-lbl">圖示</span>
          <button type="button" class="ovs-iconpick" title="更換圖示" data-icon-pick @click="openPicker({ mode: 'icon', id: it.id })">
            <img :src="iconUrl(it.icon)" alt="">
          </button>
        </div>
        <div class="ovs-field">
          <span class="ovs-lbl">顯示文字</span>
          <input
            class="ovs-txt" :maxlength="LABEL_MAX" :value="it.label" data-label
            @input="e => setLabel(it.id, e)" @compositionend="e => setLabel(it.id, e)"
          >
        </div>
        <div class="ovs-field">
          <span class="ovs-lbl">監測 CC</span>
          <span v-for="id in it.ids" :key="id" class="ovs-cchip" :data-watch="id">
            <img :src="ccIcon(id)" alt="">{{ cc(id) }}
            <button
              v-if="it.ids.length > 1 && id !== it.id" type="button" title="移除" data-watch-del
              @click="setItem(it.id, x => { x.ids = x.ids.filter(o => o !== id); })"
            >×</button>
          </span>
          <button type="button" class="ovs-mini" data-watch-add @click="openPicker({ mode: 'alt', id: it.id })">＋</button>
        </div>
        <div v-if="isMusic(it)" class="ovs-field" data-renew-field>
          <span class="ovs-lbl">自動延續</span>
          <span v-if="it.renew" class="ovs-cchip">
            <img :src="ccIcon(it.renew)" alt="">身上有{{ cc(it.renew) }}
            <button type="button" title="取消" data-renew-del @click="setItem(it.id, x => { x.renew = 0; })">×</button>
          </span>
          <button v-else type="button" class="ovs-mini" data-renew-add @click="openPicker({ mode: 'renew', id: it.id })">＋ 指定 CC</button>
        </div>
        <div class="ovs-field">
          <span class="ovs-lbl">到期提醒</span>
          剩 <input
            class="ovs-num" type="number" min="1" max="600" :value="it.warnSec" data-warn-sec
            @change="e => setWarnSec(it.id, (e.target as HTMLInputElement).value)"
          > 秒內
        </div>
        <div class="ovs-field">
          <span class="ovs-lbl" />
          <DCheckbox label="高亮" :model-value="it.warnHl" data-warn-hl @update:model-value="v => setItem(it.id, x => { x.warnHl = v; })" />
          <SoonChecks />
        </div>
        <div class="ovs-field">
          <span class="ovs-lbl">失效提醒</span>
          <DCheckbox label="高亮" :model-value="it.goneHl" data-gone-hl @update:model-value="v => setItem(it.id, x => { x.goneHl = v; })" />
          <SoonChecks />
        </div>
        <div class="ovs-field top">
          <span class="ovs-lbl">自身秘法</span>
          <ArcanaChips :model-value="it.arcana" @update:model-value="v => setItem(it.id, x => { x.arcana = v; })" />
        </div>
        <div v-if="section === 'ccParty'" class="ovs-field top" data-mate-arcana>
          <span class="ovs-lbl">隊友秘法</span>
          <ArcanaChips :model-value="it.mateArcana" @update:model-value="v => setItem(it.id, x => { x.mateArcana = v; })" />
        </div>
      </ItemRow>
      <DButton size="sm" data-add @click="openPicker({ mode: 'add' })">＋ 新增 CC</DButton>
      <p class="ovs-pos">位置在「遊戲內排版編輯」調整。</p>
    </div>
    <ItemPicker
      v-if="picker" v-bind="picker" :source="iconSrc"
      @pick="onPick" @close="pickCtx = null" @update:source="(v: string) => iconSrc = v === 'skill' ? 'skill' : 'cc'"
    />
  </div>
</template>

<style scoped>
.top { align-items: flex-start; }
</style>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { condNameMap, region, skillNameMap } from '@/store';
import { ccIconUrl, ccName } from '@/lib/util';
import { COMPONENT_NAMES } from '@/lib/overlayComponents';
import {
    defaultCcItem, defaultCcSection, itemKey, MUSIC_CC,
    type CcItem, type CcLook, type CcSection, type CcSectionId, type IconRef,
} from '@/lib/overlaySections';
import { itemName } from '@/overlay/sectionView';
import { overlaySettings, updateOverlaySettings } from '../../overlay/overlayLink';
import DButton from '../../ui/DButton.vue';
import DCheckbox from '../../ui/DCheckbox.vue';
import ArcanaChips from './ArcanaChips.vue';
import FrameBlock from './FrameBlock.vue';
import FrameLookFields from './FrameLookFields.vue';
import ItemPicker, { type PickerItem, type PickerMark } from './ItemPicker.vue';
import ItemRow from './ItemRow.vue';
import SoonChecks from './SoonChecks.vue';
import { useFrameBlocks, useSectionLayout } from './sectionLayout';

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

const { forget } = useSectionLayout(() => props.section);
const { blocks, toggle, onLook, onFollow, onReset } = useFrameBlocks(
    () => props.section, () => look.value,
    l => setSec(s => { s.look = l as CcLook; }),
    () => setSec(s => { s.look = defaultCcSection(props.section).look; }),
);
const itemsOf = (keys: string[]) => keys.map(k => sec.value.items.find(i => itemKey(i) === k)).filter((i): i is CcItem => !!i);
const openId = ref<number | null>(null);

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
    <FrameBlock
      v-for="f in blocks" :key="f.id"
      :title="f.title" :summary="f.summary" :open="f.open" :data-frame="f.id"
      @toggle="toggle(f.id)" @reset="onReset(f.id)"
    >
      <template #look>
        <FrameLookFields
          :look="f.look" :section="section" :follow="f.follow" :main-title="blocks[0].title"
          @update:look="l => onLook(f.id, l)" @update:follow="v => onFollow(f.id, v)"
        />
      </template>
      <template v-if="!lookOnly" #items>
          <ItemRow
            v-for="it in itemsOf(f.keys)" :key="it.id"
            :item-key="itemKey(it)" :icon="iconUrl(it.icon)" :name="nameOf(it)"
            :enabled="it.enabled" :open="openId === it.id"
            @toggle="openId = openId === it.id ? null : it.id"
            @reset="reset(it.id)" @remove="remove(it)"
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
              <ArcanaChips :model-value="it.arcana" @update:model-value="(v: number[]) => setItem(it.id, x => { x.arcana = v; })" />
            </div>
            <div v-if="section === 'ccParty'" class="ovs-field top" data-mate-arcana>
              <span class="ovs-lbl">隊友秘法</span>
              <ArcanaChips :model-value="it.mateArcana" @update:model-value="(v: number[]) => setItem(it.id, x => { x.mateArcana = v; })" />
            </div>
          </ItemRow>
        <DButton v-if="f.kind === 'section'" size="sm" data-add @click="openPicker({ mode: 'add' })">＋ 新增 CC</DButton>
      </template>
    </FrameBlock>
    <p class="ovs-pos">位置在「遊戲內排版編輯」調整。把 icon 拉出來就會多一塊。</p>
    <ItemPicker
      v-if="picker" v-bind="picker" :source="iconSrc"
      @pick="onPick" @close="pickCtx = null" @update:source="(v: string) => iconSrc = v === 'skill' ? 'skill' : 'cc'"
    />
  </div>
</template>

<style scoped>
.top { align-items: flex-start; }
</style>

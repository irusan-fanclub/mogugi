<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { itemNameMap, itemUpgradeMap } from '@/store';
import type { IndexItem } from '@/lib/itemIndex';
import { RANK_ITEMS } from '@/lib/musicData';
import {
    gearInputs, compute, renderProcat, formatDuration, loadManual, saveManual, defaultManual, type ManualInputs,
} from '@/lib/musicAnalysis';
import { GROUPS, RANKS, DEFAULT_OPEN, pct } from '@/lib/musicForm';
import DButton from '../../ui/DButton.vue';
import DCheckbox from '../../ui/DCheckbox.vue';
import DNumberField from '../../ui/DNumberField.vue';
import DSelect from '../../ui/DSelect.vue';
import DTextField from '../../ui/DTextField.vue';
import DTextarea from '../../ui/DTextarea.vue';
import { zhPunct } from '../../text/zhPunct';

const props = defineProps<{
    items: { pocket: number; item: IndexItem }[];
    instrumentPocket: number;
}>();

// itemNameMap values are "name id"; strip the trailing id.
const itemName = (id: number) => (itemNameMap.value[id] ?? '').replace(/\s*\d+$/, '');
const upgradeName = (id: number) => itemUpgradeMap.value[id]?.name;

const manual = reactive<ManualInputs>(loadManual());
watch(manual, m => saveManual({ ...m }), { deep: true });
const reset = () => Object.assign(manual, defaultManual());

const auto = computed(() => gearInputs(props.items, { itemName, upgradeName, instrumentPocket: props.instrumentPocket }));
const inputs = computed(() => ({ auto: auto.value, manual: { ...manual } }));
const result = computed(() => compute(inputs.value));
const text = computed(() => renderProcat(inputs.value));

const rec = manual as unknown as Record<string, number | boolean>;
const num = (k: string) => rec[k] as number;
const setNum = (k: string, v: number) => { rec[k] = v; };
const flag = (k: string) => rec[k] as boolean;
const setFlag = (k: string, v: boolean) => { rec[k] = v; };

// DSelect works on strings; ranks are numeric indexes.
const rankItems = RANK_ITEMS.map(r => ({ value: String(r.value), title: r.title }));
const rankModel = (k: string) => String(rec[k]);
const setRank = (k: string, v: string) => { rec[k] = Number(v); };

const open = ref<string[]>(DEFAULT_OPEN.slice());
function toggle(title: string) {
    open.value = open.value.includes(title) ? open.value.filter(t => t !== title) : [...open.value, title];
}

const autoText = (k: string) => String((auto.value as unknown as Record<string, number>)[k]);
const autoTitle = (k: string) => (auto.value.detail as Record<string, string | undefined>)[k] ?? '裝備上沒有';

const copyNote = ref('');
let noteTimer: ReturnType<typeof setTimeout> | undefined;
async function copy() {
    try {
        await navigator.clipboard.writeText(text.value);
        copyNote.value = '已複製';
    } catch {
        copyNote.value = '無法自動複製，請手動選取';
    }
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { copyNote.value = ''; }, 2000);
}
</script>

<template>
  <div class="ma">
    <div class="sub">音樂效果</div>
    <div class="songs">
      <table v-for="s in result.songs" :key="s.key" class="song" data-song>
        <thead>
          <tr><th colspan="4">{{ s.label }} <span class="hint">加成池 {{ s.pool }}%</span></th></tr>
          <tr><th /><th>普通</th><th>優秀</th><th>天籟</th></tr>
        </thead>
        <tbody>
          <tr v-for="o in s.outputs" :key="o.key">
            <td class="lab">{{ o.label }}</td>
            <td>{{ pct(o.values.normal) }}</td>
            <td>{{ pct(o.values.excellent) }}</td>
            <td>{{ pct(o.values.inspiring) }}</td>
          </tr>
          <tr>
            <td class="lab">持續</td>
            <td colspan="3">
              {{ formatDuration(s.durationSec) }}<span class="hint">（圖安 {{ formatDuration(s.tuanSec) }}）</span>
              <span v-if="s.key === 'march'" class="hint">待驗</span>
            </td>
          </tr>
        </tbody>
      </table>
      <table class="song" data-ratio>
        <thead><tr><th colspan="2">演奏比例 <span class="hint">公式來源：洛普貓聊天區</span></th></tr></thead>
        <tbody>
          <tr><td class="lab">天籟</td><td>{{ pct(result.ratio.inspiring * 100) }}</td></tr>
          <tr><td class="lab">優秀</td><td>{{ pct(result.ratio.excellent * 100) }}</td></tr>
          <tr><td class="lab">普通</td><td>{{ pct(result.ratio.normal * 100) }}</td></tr>
        </tbody>
      </table>
    </div>
    <div class="hint note">施工中，數值僅供參考。基礎持續 60 秒與進行曲持續為推定值；精靈龍 2% 先加後乘評級。</div>

    <div class="sub gap">輸入 <span class="hint">灰底為裝備自動算出，滑鼠停留顯示來源；其餘手填並記住</span></div>
    <div class="ranks">
      <label v-for="r in RANKS" :key="r.key" class="rank">
        <span class="rank-lab">{{ r.label }}</span>
        <DSelect :model-value="rankModel(r.key)" :items="rankItems" data-rank @update:model-value="setRank(r.key, $event)" />
      </label>
      <DButton size="sm" data-reset @click="reset">清除手填</DButton>
    </div>

    <div class="acc">
      <section v-for="g in GROUPS" :key="g.title" class="grp" data-group>
        <button type="button" class="grp-hd" :aria-expanded="open.includes(g.title)" @click="toggle(g.title)">
          <i class="mdi" :class="open.includes(g.title) ? 'mdi-chevron-down' : 'mdi-chevron-right'" />
          {{ zhPunct(g.title) }}
        </button>
        <div v-if="open.includes(g.title)" class="grp-bd">
          <div class="grid">
            <template v-for="f in g.fields" :key="f.key">
              <label v-if="f.kind === 'auto'" class="fld">
                <span class="fld-lab">{{ zhPunct(f.label) }}</span>
                <DTextField class="auto" :model-value="autoText(f.key)" readonly :title="autoTitle(f.key)" data-auto />
              </label>
              <label v-else-if="f.kind === 'number'" class="fld">
                <span class="fld-lab">{{ zhPunct(f.label) }}</span>
                <DNumberField :model-value="num(f.key)" :hint="f.hint && zhPunct(f.hint)" data-num @update:model-value="setNum(f.key, $event)" />
              </label>
              <DCheckbox v-else :label="zhPunct(f.label)" :model-value="flag(f.key)" data-check @update:model-value="setFlag(f.key, $event)" />
            </template>
          </div>
          <div v-if="g.title === '調整參數' && auto.holyWaterHint" class="hint note">
            聖水刻印的音樂技能效果合計 {{ auto.holyWaterHint }}（推測），可填入「音樂效果技能效果」。
          </div>
        </div>
      </section>
    </div>

    <div class="sub gap">
      普洛貓 !music
      <DButton size="sm" data-copy @click="copy">複製</DButton>
      <span class="hint">{{ copyNote }}</span>
    </div>
    <DTextarea class="procat" :model-value="text" readonly :rows="8" data-text />
  </div>
</template>

<style scoped>
.ma { margin-top: var(--space-4); }
.sub { display: flex; align-items: center; gap: var(--space-3); margin-bottom: var(--space-2); font-size: var(--fs-md); color: var(--c-text); }
.gap { margin-top: var(--space-5); }
.hint { font-size: var(--fs-sm); color: var(--c-text-dim); }
.note { margin-top: var(--space-2); }
.songs { display: flex; flex-wrap: wrap; gap: var(--space-4); align-items: flex-start; }
.song { min-width: 260px; border-collapse: collapse; background: var(--c-surface); border-radius: var(--radius); }
.song th, .song td { padding: var(--space-2) var(--space-3); white-space: nowrap; text-align: right; border-bottom: 1px solid var(--c-line); }
.song th:first-child, .song td:first-child { text-align: left; }
.song td[colspan] { text-align: left; }
.lab { color: var(--c-text-dim); }
.ranks { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: flex-end; }
.rank { display: flex; flex-direction: column; gap: var(--space-1); width: 140px; }
.rank-lab, .fld-lab { font-size: var(--fs-sm); color: var(--c-text-dim); }
.acc { margin-top: var(--space-3); border: 1px solid var(--c-line); border-radius: var(--radius); }
.grp + .grp { border-top: 1px solid var(--c-line); }
.grp-hd {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: var(--row-h);
    padding: 0 var(--space-3);
    border: 0;
    background: var(--c-surface);
    color: var(--c-text);
    font: inherit;
    text-align: left;
    cursor: pointer;
}
.grp-hd:hover { background: var(--c-surface-2); }
.grp-bd { padding: var(--space-3); }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--space-3); }
.fld { display: flex; flex-direction: column; gap: var(--space-1); }
.auto :deep(input) { background: var(--c-surface-2); color: var(--c-text-dim); }
.procat :deep(textarea) { font-family: var(--font-num); font-size: var(--fs-sm); }
</style>

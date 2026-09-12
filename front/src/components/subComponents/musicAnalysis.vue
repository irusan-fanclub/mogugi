<template>
    <div class="ma-root">
        <!-- Results -->
        <div class="text-subtitle-2 mb-1">音樂效果</div>
        <div class="ma-songs">
            <v-table v-for="s in result.songs" :key="s.key" density="compact" class="ma-song">
                <thead>
                    <tr><th colspan="4">{{ s.label }} <span class="ma-hint">加成池 {{ s.pool }}%</span></th></tr>
                    <tr><th></th><th>普通</th><th>優秀</th><th>天籟</th></tr>
                </thead>
                <tbody>
                    <tr v-for="o in s.outputs" :key="o.key">
                        <td class="ma-label">{{ o.label }}</td>
                        <td>{{ pct(o.values.normal) }}</td><td>{{ pct(o.values.excellent) }}</td><td>{{ pct(o.values.inspiring) }}</td>
                    </tr>
                    <tr>
                        <td class="ma-label">持續</td>
                        <td colspan="3">{{ formatDuration(s.durationSec) }}<span class="ma-hint">(圖安 {{ formatDuration(s.tuanSec) }})</span>
                            <span v-if="s.key === 'march'" class="ma-hint">待驗</span></td>
                    </tr>
                </tbody>
            </v-table>
            <v-table density="compact" class="ma-song">
                <thead><tr><th colspan="2">演奏比例 <span class="ma-hint">公式來源:洛普貓聊天區</span></th></tr></thead>
                <tbody>
                    <tr><td class="ma-label">天籟</td><td>{{ pct(result.ratio.inspiring * 100) }}</td></tr>
                    <tr><td class="ma-label">優秀</td><td>{{ pct(result.ratio.excellent * 100) }}</td></tr>
                    <tr><td class="ma-label">普通</td><td>{{ pct(result.ratio.normal * 100) }}</td></tr>
                </tbody>
            </v-table>
        </div>
        <div class="ma-hint mt-1">施工中,數值僅供參考。基礎持續 60 秒與進行曲持續為推定值;精靈龍 2% 先加後乘評級。</div>

        <!-- Inputs -->
        <div class="text-subtitle-2 mt-4 mb-1">輸入 <span class="ma-hint">灰底為裝備自動算出,滑鼠停留顯示來源;其餘手填並記住</span></div>
        <div class="ma-row">
            <v-select v-for="r in RANKS" :key="r.key" :label="r.label" :items="RANK_ITEMS" v-model="manual[r.key]"
                density="compact" variant="outlined" hide-details class="ma-rank" />
            <v-btn size="small" variant="text" @click="reset">清除手填</v-btn>
        </div>
        <v-expansion-panels v-model="open" multiple variant="accordion" class="mt-2">
            <v-expansion-panel v-for="g in groups" :key="g.title" :title="g.title" :value="g.title">
                <v-expansion-panel-text>
                    <div class="ma-grid">
                        <template v-for="f in g.fields" :key="f.key">
                            <v-text-field v-if="f.kind === 'auto'" :label="f.label" :model-value="auto[f.key]" readonly
                                density="compact" variant="filled" hide-details :title="auto.detail[f.key] ?? '裝備上沒有'" class="ma-auto" />
                            <v-text-field v-else-if="f.kind === 'number'" :label="f.label" type="number" v-model.number="manual[f.key]"
                                density="compact" variant="outlined" hide-details :hint="f.hint" :persistent-hint="!!f.hint" />
                            <v-checkbox v-else :label="f.label" v-model="manual[f.key]" density="compact" hide-details />
                        </template>
                    </div>
                    <div v-if="g.title === '調整參數' && auto.holyWaterHint" class="ma-hint mt-1">聖水刻印的音樂技能效果合計 {{ auto.holyWaterHint }}(推測),可填入「音樂效果技能效果」。</div>
                </v-expansion-panel-text>
            </v-expansion-panel>
        </v-expansion-panels>

        <!-- 普洛貓 text -->
        <div class="text-subtitle-2 mt-4 mb-1">普洛貓 !music
            <v-btn size="small" variant="tonal" class="ml-2" @click="copy">複製</v-btn>
            <span class="ma-hint ml-2">{{ copyNote }}</span>
        </div>
        <v-textarea :model-value="text" readonly auto-grow rows="8" variant="outlined" density="compact" class="ma-text" />
    </div>
</template>

<script lang="ts">
import { defineComponent, inject, computed, reactive, ref, watch, type PropType, type Ref } from 'vue';
import type { ItemUpgrade } from '@/store';
import type { IndexItem } from '@/lib/itemIndex';
import { RANK_ITEMS } from '@/lib/musicData';
import {
    gearInputs, compute, renderProcat, formatDuration, loadManual, saveManual, defaultManual,
    type AutoInputs, type ManualInputs,
} from '@/lib/musicAnalysis';

type AutoKey = Exclude<keyof AutoInputs, 'detail' | 'holyWaterHint'>;
type Field =
    | { kind: 'auto'; key: AutoKey; label: string }
    | { kind: 'number'; key: keyof ManualInputs; label: string; hint?: string }
    | { kind: 'check'; key: keyof ManualInputs; label: string };
const A = (key: AutoKey, label: string): Field => ({ kind: 'auto', key, label });
const N = (key: keyof ManualInputs, label: string, hint?: string): Field => ({ kind: 'number', key, label, hint });
const C = (key: keyof ManualInputs, label: string): Field => ({ kind: 'check', key, label });

// Form groups in template order.
const GROUPS: { title: string; fields: Field[] }[] = [
    { title: '角色細工', fields: [
        A('playEffect', '樂器演奏效果'), A('inspEffect', '天籟之音演奏效果'), A('inspRatio', '天籟之音演奏比例'),
        A('excelEffect', '優秀的演奏效果'), A('excelRatioEcho', '回音 優秀演奏比例'), A('excelRatioInstrument', '樂器 優秀演奏比例'),
        A('excelRatioLeft', '左飾品 優秀演奏比例'), A('excelRatioRight', '右飾品 優秀演奏比例'), A('normalEffect', '普通演奏效果'),
        A('battleDuration', '戰場的序曲持續時間'), A('livelyDuration', '活潑板持續時間'), A('livelySpeed', '活潑板ＸＸ速度'),
        A('marchDuration', '進行曲持續時間'), A('marchWalk', '進行曲徒步移動速度'), A('marchRide', '進行曲寵物移動速度'),
    ] },
    { title: '角色稱號效果', fields: [
        N('titleBattle', '戰場的序曲技能效果', '戰場的序曲大師 8'), N('titleLively', '活潑板效果'), N('titleMarch', '進行曲效果'),
        N('titleMusic', '音樂技能效果', '音樂家 5;二稱 歐哈德 11/13,特別的夢幻之花 12'), N('titleDuration', '音樂效果持續時間'),
    ] },
    { title: '角色裝備狀態', fields: [
        A('silkWing', '特別的優雅絲緞翅膀'), A('romanceHat', '吟遊詩人浪漫假髮與帽子'), A('romanceDress', '特別吟遊詩人浪漫服裝'),
        A('romanceShoes', '吟遊詩人浪漫鞋子'), A('seraphHand', '熾天使歌唱手部裝飾'),
        C('arcana', '祕法聖詠者啓用'), C('master', '一代宗師吟遊詩人效果'), C('couple', '情侶同步手部服裝'),
        C('dragonRed', '紅炎的精靈龍'), C('dragonBlue', '蒼冰的精靈龍'), C('dragonOrigin', '原初精靈龍'),
        C('potion', '音樂強化藥水'), C('hornNormal', '柯勒斐雷的喇叭'), C('hornBlessed', '充滿大祝福的柯勒斐雷喇叭'),
        C('cardLover', '卡片神諭戀人'), C('cardChariot', '卡片神諭戰車'), C('cardSun', '卡片神諭太陽'),
    ] },
    { title: '角色其他狀態(只進文字)', fields: [
        N('harmony', '好奇心的和聲 0-7'), N('circleBattle', '戰場序曲魔法陣 0-10'), N('circleLively', '活潑板魔法陣 0-10'), N('circleMarch', '進行曲魔法陣 0-10'),
    ] },
    { title: '角色樂器', fields: [
        A('instrumentUpgrade', '改造音樂技能效果'), A('instrumentEnchant', '賦予音樂技能效果'),
        A('instrumentUpgradeDuration', '改造音樂增益持續時間'), A('instrumentEnchantDuration', '賦予音樂增益持續時間'),
        A('srPercent', 'ＳＲ改造戰場活潑攻擊％'), A('gradePercent', '裝備等級戰場活潑攻擊％'),
    ] },
    { title: '裝備賦予、農場物、娃娃背包', fields: [
        A('enchantLeft', '左飾品'), A('enchantRight', '右飾品'), A('enchantHead', '頭部'), A('enchantBody', '身體'),
        A('enchantHand', '手部'), A('enchantFoot', '腳部'), A('enchantWing', '翅膀'),
        N('farmEffect', '農場物音樂技能效果'), N('dollEffect', '娃娃背包音樂技能效果'),
        A('durationHead', '頭部持續時間'), A('durationBody', '身體持續時間'), A('durationWing', '翅膀持續時間'), N('dollDuration', '娃娃背包持續時間'),
    ] },
    { title: '調整參數', fields: [N('adjEffect', '音樂效果技能效果'), N('adjDuration', '音樂增益持續時間'), N('adjAttack', '戰場活潑攻擊力％')] },
    { title: '切裝設定值(只進文字)', fields: [
        N('swap1', '活潑板音樂效果減少值'), N('swap2', '活潑板細工天籟效果減少值'), N('swap3', '進行曲音樂效果減少值'), N('swap4', '進行曲細工天籟效果減少值'),
    ] },
];
const RANKS: { key: keyof ManualInputs; label: string }[] = [
    { key: 'rankBattle', label: '戰場的序曲' }, { key: 'rankLively', label: '活潑板' }, { key: 'rankMarch', label: '進行曲' },
    { key: 'rankPlay', label: '樂器演奏' }, { key: 'rankSing', label: '歌唱' },
];

export default defineComponent({
    props: {
        items: { type: Array as PropType<{ pocket: number; item: IndexItem }[]>, required: true },
        instrumentPocket: { type: Number, required: true },
    },
    setup(props) {
        const itemNameMap = inject('itemNameMap') as Ref<Record<number, string>>;
        const itemUpgradeMap = inject('itemUpgradeMap') as Ref<Record<number, ItemUpgrade>>;
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

        const open = ref<string[]>(['角色細工', '角色樂器']);
        const copyNote = ref('');
        const copy = async () => {
            try {
                await navigator.clipboard.writeText(text.value);
                copyNote.value = '已複製';
            } catch {
                copyNote.value = '無法自動複製,請手動選取';
            }
            setTimeout(() => { copyNote.value = ''; }, 2000);
        };
        const pct = (v: number) => `${v.toFixed(2)}%`;

        return { RANK_ITEMS, RANKS, groups: GROUPS, manual, auto, result, text, open, copyNote, copy, pct, reset, formatDuration };
    },
});

</script>

<style scoped>
.ma-songs { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; }
.ma-song { min-width: 260px; }
.ma-song th, .ma-song td { white-space: nowrap; }
.ma-label { color: #999; }
.ma-hint { font-size: 0.75rem; color: #999; margin-left: 6px; }
.ma-row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.ma-rank { max-width: 140px; }
.ma-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 8px; }
.ma-grid :deep(.v-input) { width: 100%; }
.ma-auto :deep(input) { color: #bbb; }
.ma-text :deep(textarea) { font-family: ui-monospace, Consolas, monospace; font-size: 0.8rem; }
</style>

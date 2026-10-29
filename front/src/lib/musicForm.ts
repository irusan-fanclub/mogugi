// musicForm.ts — 音樂分析 input-form layout (groups, fields, rank selectors), shared by both UIs.
import type { AutoInputs, ManualInputs } from './musicAnalysis';

export type AutoKey = Exclude<keyof AutoInputs, 'detail' | 'holyWaterHint'>;
export type Field =
    | { kind: 'auto'; key: AutoKey; label: string }
    | { kind: 'number'; key: keyof ManualInputs; label: string; hint?: string }
    | { kind: 'check'; key: keyof ManualInputs; label: string };
const A = (key: AutoKey, label: string): Field => ({ kind: 'auto', key, label });
const N = (key: keyof ManualInputs, label: string, hint?: string): Field => ({ kind: 'number', key, label, hint });
const C = (key: keyof ManualInputs, label: string): Field => ({ kind: 'check', key, label });

// Form groups in template order.
export const GROUPS: { title: string; fields: Field[] }[] = [
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
export const RANKS: { key: keyof ManualInputs; label: string }[] = [
    { key: 'rankBattle', label: '戰場的序曲' }, { key: 'rankLively', label: '活潑板' }, { key: 'rankMarch', label: '進行曲' },
    { key: 'rankPlay', label: '樂器演奏' }, { key: 'rankSing', label: '歌唱' },
];
// Initially expanded form groups.
export const DEFAULT_OPEN = ['角色細工', '角色樂器'];
export const pct = (v: number): string => `${v.toFixed(2)}%`;

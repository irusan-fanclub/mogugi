// musicData.ts — game data for the 音樂分析 view: metalware ids, rank/skill
// tables, song base tables, flat bonuses, item-name rules, 普洛貓 template.

// Metalware ability ids from mabi_tw.sqlite metalware_ability.
export const MW = {
    playEffect: 1000307, inspEffect: 1000606, inspRatio: 1000603, excelEffect: 1000605,
    excelRatio: 1000602, normalEffect: 1000604,
    battleDuration: 5310103, livelyDuration: 5310303,
    livelyMagicSpeed: 5310305, livelyAlchemySpeed: 5310306, livelyAttackSpeed: 5310307,
    marchDuration: 5310603, marchWalk: 5310605, marchRide: 5310606,
} as const;

export const ENCHANT_MUSIC_EFFECT = 113;
export const ENCHANT_MUSIC_DURATION = 114;

export const ECHO_POCKETS = [62, 63, 64];
export const WEAPON_SETS: Record<number, number[]> = { 10: [10, 13], 11: [11, 14] };

// Rank index 0..14 = R1..RF, 15 = 練習.
export const RANK_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F', '練習'];
export const RANK_ITEMS = RANK_LABELS.map((label, value) => ({ title: value === 15 ? '練習' : `R${label}`, value }));
export const PRACTICE_RANK = 15;
// 樂器演奏 / 歌唱 contribution to the music-effect pool by rank index.
export const SKILL_VALUE_BY_RANK = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

export type SongKey = 'battle' | 'lively' | 'march';
export type DragonColor = 'red' | 'blue';
export type ReforgeLine = 'livelySpeed' | 'marchWalk' | 'marchRide';
export interface SongOutput {
    key: string; label: string;
    base: number[];          // by rank index 0..14
    extra: boolean;          // multiplied by the rating factor (SR + 裝備等級 + 調整)
    dragon: boolean;         // gets the matching-colour 精靈龍 2% of base
    reforge?: ReforgeLine;   // metalware level added to base
}
export interface SongDef { key: SongKey; label: string; dragonColor?: DragonColor; outputs: SongOutput[] }

const DMG = [20, 19, 18, 17, 16, 16, 15, 15, 14, 13, 13, 12, 12, 11, 10];
export const SONGS: SongDef[] = [
    { key: 'battle', label: '戰場的序曲', dragonColor: 'red', outputs: [
        { key: 'maxDamage', label: '最大傷害 %', base: DMG, extra: true, dragon: true },
    ] },
    { key: 'lively', label: '活潑板', dragonColor: 'blue', outputs: [
        { key: 'magicAttack', label: '魔法攻擊力 %', base: DMG, extra: true, dragon: true },
        { key: 'magicSpeed', label: '魔法施展速度 %', base: [11, 10, 9, 8, 7, 7, 6, 6, 5, 4, 4, 3, 2, 2, 2], extra: false, dragon: true, reforge: 'livelySpeed' },
        { key: 'alchemySpeed', label: '鍊金術施展速度 %', base: [11, 10, 9, 8, 7, 6, 6, 5, 5, 4, 3, 3, 2, 2, 2], extra: false, dragon: true, reforge: 'livelySpeed' },
        { key: 'attackSpeed', label: '攻擊速度 %', base: [11, 10, 9, 8, 7, 6, 5, 4, 4, 3, 3, 2, 2, 1, 1], extra: false, dragon: true, reforge: 'livelySpeed' },
    ] },
    { key: 'march', label: '進行曲', outputs: [
        { key: 'walkSpeed', label: '徒步移動速度 %', base: [12, 10, 8, 8, 7, 7, 6, 6, 5, 3, 3, 2, 2, 1, 1], extra: false, dragon: false, reforge: 'marchWalk' },
        { key: 'rideSpeed', label: '寵物搭乘移動速度 %', base: [9, 8, 8, 7, 7, 6, 6, 5, 5, 4, 3, 3, 2, 2, 1], extra: false, dragon: false, reforge: 'marchRide' },
    ] },
];

export const SR_PERCENT: Record<number, number> = { 1: 0.5, 2: 1, 3: 1.5, 4: 2.3, 5: 3, 6: 3.8, 7: 4.5, 8: 5.5 };
export const GRADE_BASE = { normal: 1.0, excellent: 1.1, inspiring: 1.3 } as const;

// Flat bonuses into the music-effect pool (per-song ones noted).
export const BONUS = {
    silkWing: 1, couple: 1, arcana: 3, master: 5, potion: 2, cardLover: 2, dragonAny: 3,
    hornBlessed: 5, hornNormal: 2,
    seraphHand: 5, romanceDress: 3,   // 戰場 only
    romanceHat: 3,                    // 活潑 only
    romanceShoes: 3,                  // 進行曲 only
} as const;

export const DURATION = { base: 60, perLevel: 5, master: 30, silkWing: 30, arcana: 180, couple: 2, romanceShoes: 10, tuanFactor: 3 } as const;
export const RATIO = { inspiringCap: 120, excellentCap: 350, inspiringWeight: 15, excellentWeight: 75, scale: 296 / 30, wingBonus: 2 } as const;

// Instrument inherent music effect by name substring (first match wins; 待實測).
export const INSTRUMENT_BASE: [string, number][] = [['靈魂解放者里拉', 22], ['惡魔黑色星期天', 16], ['里拉', 10]];
export const INSTRUMENT_DEFAULT_BASE = 8;
export const TUNE_UPGRADE_NAME = '調整旋律';

// Name keywords that mark an instrument (待實測; a miss only drops the inherent 8).
export const INSTRUMENT_NAME_HINTS = [
    '里拉', '豎琴', '琴', '笛', '鼓', '喇叭', '號', '烏克麗麗', '曼陀林', '蕭姆管', '指揮棒', '風琴', '吉他',
    '鈴', '鐘', '木魚', '鑼', '琵琶', '三味線', '馬林巴', '排笛', '陶笛', '薩克斯風', '巴松', '雙簧管', '單簧管', '沙鈴', '響板',
];

export type SetItemKey = 'silkWing' | 'romanceHat' | 'romanceDress' | 'romanceShoes' | 'seraphHand';
export const SET_ITEM_RULES: { key: SetItemKey; label: string; test: (name: string) => boolean }[] = [
    { key: 'silkWing', label: '特別的優雅絲緞翅膀', test: n => n.startsWith('特別的優雅絲緞翅膀') },
    { key: 'romanceHat', label: '吟遊詩人浪漫假髮與帽子', test: n => n.includes('吟遊詩人浪漫假髮與帽子') },
    { key: 'romanceDress', label: '特別吟遊詩人浪漫服裝', test: n => n.startsWith('特別吟遊詩人浪漫') && n.includes('服裝') },
    { key: 'romanceShoes', label: '吟遊詩人浪漫鞋子', test: n => n.includes('吟遊詩人浪漫鞋子') },
    { key: 'seraphHand', label: '熾天使歌唱手部裝飾', test: n => n.includes('熾天使歌唱手部裝飾') },
];

// 普洛貓 !music template: a string is a literal line, a tuple is
// "<prefix><value>" where prefix already ends with the full-width colon.
export type ProcatKey =
    | 'playEffect' | 'inspEffect' | 'inspRatio' | 'excelEffect'
    | 'excelRatioEcho' | 'excelRatioInstrument' | 'excelRatioLeft' | 'excelRatioRight'
    | 'normalEffect' | 'battleDuration' | 'livelyDuration' | 'livelySpeed'
    | 'marchDuration' | 'marchWalk' | 'marchRide'
    | 'titleBattle' | 'titleLively' | 'titleMarch' | 'titleMusic' | 'titleDuration'
    | 'silkWing' | 'romanceHat' | 'romanceDress' | 'romanceShoes' | 'seraphHand'
    | 'arcana' | 'master' | 'couple' | 'dragonRed' | 'dragonBlue' | 'dragonOrigin'
    | 'potion' | 'hornNormal' | 'hornBlessed' | 'cardLover' | 'cardChariot' | 'cardSun'
    | 'harmony' | 'circleBattle' | 'circleLively' | 'circleMarch'
    | 'instrumentUpgrade' | 'instrumentEnchant' | 'instrumentUpgradeDuration' | 'instrumentEnchantDuration'
    | 'srPercent' | 'gradePercent'
    | 'enchantLeft' | 'enchantRight' | 'enchantHead' | 'enchantBody' | 'enchantHand' | 'enchantFoot' | 'enchantWing'
    | 'farmEffect' | 'dollEffect'
    | 'durationHead' | 'durationBody' | 'durationWing' | 'dollDuration'
    | 'adjEffect' | 'adjDuration' | 'adjAttack'
    | 'swap1' | 'swap2' | 'swap3' | 'swap4';

export type ProcatLine = string | [string, ProcatKey];
export const PROCAT_TEMPLATE: ProcatLine[] = [
    '!music',
    '【角色細工(自己算總和，max(身體所有部位細工總和,回音) )，優演比例例外】',
    ['　　　　　　　樂器演奏效果：', 'playEffect'],
    ['　音樂知識天籟之音演奏效果：', 'inspEffect'],
    ['　音樂知識天籟之音演奏比例：', 'inspRatio'],
    ['　　音樂知識優秀的演奏效果：', 'excelEffect'],
    ['　回音音樂知識優秀演奏比例：', 'excelRatioEcho'],
    ['　樂器音樂知識優秀演奏比例：', 'excelRatioInstrument'],
    ['　左飾品音樂知識優演奏比例：', 'excelRatioLeft'],
    ['　右飾品音樂知識優演奏比例：', 'excelRatioRight'],
    ['　　　音樂知識普通演奏效果：', 'normalEffect'],
    ['　　　　戰場的序曲持續時間：', 'battleDuration'],
    ['　　　　　　活潑板持續時間：', 'livelyDuration'],
    ['　　　　　　活潑板ＸＸ速度：', 'livelySpeed'],
    ['　　　　　　進行曲持續時間：', 'marchDuration'],
    ['　　　　進行曲徒步移動速度：', 'marchWalk'],
    ['　　　　進行曲寵物移動速度：', 'marchRide'],
    '【角色稱號效果 (第一稱號 + 第二稱號)】',
    ['　　　　戰場的序曲技能效果：', 'titleBattle'],
    ['　　　　　　　　活潑板效果：', 'titleLively'],
    ['　　　　　　　　進行曲效果：', 'titleMarch'],
    ['　　　　　　　音樂技能效果：', 'titleMusic'],
    ['　　　　　音樂效果持續時間：', 'titleDuration'],
    '【角色裝備狀態 (1:發動  0:未發動)】',
    ['　　　　特別的優雅絲緞翅膀：', 'silkWing'],
    ['　　吟遊詩人浪漫假髮與帽子：', 'romanceHat'],
    ['　　　特別吟遊詩人浪漫服裝：', 'romanceDress'],
    ['　　　　　吟遊詩人浪漫鞋子：', 'romanceShoes'],
    ['　　　　熾天使歌唱手部裝飾：', 'seraphHand'],
    ['　　　　　　祕法聖詠者啓用：', 'arcana'],
    ['　一代宗師吟遊詩人效果啓用：', 'master'],
    ['　情侶同步手部服裝效果發動：', 'couple'],
    ['　　　紅炎的精靈龍召喚狀態：', 'dragonRed'],
    ['　　　蒼冰的精靈龍召喚狀態：', 'dragonBlue'],
    ['　　　　原初精靈龍召喚狀態：', 'dragonOrigin'],
    ['　　　　　　　音樂強化藥水：', 'potion'],
    ['　　　　　　柯勒斐雷的喇叭：', 'hornNormal'],
    ['　充滿大祝福的柯勒斐雷喇叭：', 'hornBlessed'],
    ['　　　卡片神諭戀人音樂效果：', 'cardLover'],
    ['　　　卡片神諭戰車戰場時間：', 'cardChariot'],
    ['　　　卡片神諭太陽活潑時間：', 'cardSun'],
    '【角色其他狀態 (打數字)】',
    ['　　好奇心的和聲　０～７　：', 'harmony'],
    ['　戰場序曲魔法陣　０～１０：', 'circleBattle'],
    ['　　活潑板魔法陣　０～１０：', 'circleLively'],
    ['　　進行曲魔法陣　０～１０：', 'circleMarch'],
    '【角色樂器】',
    ['　　　樂器改造音樂技能效果：', 'instrumentUpgrade'],
    ['　　　樂器賦予音樂技能效果：', 'instrumentEnchant'],
    ['　樂器改造音樂增益持續時間：', 'instrumentUpgradeDuration'],
    ['　樂器賦予音樂增益持續時間：', 'instrumentEnchantDuration'],
    ['樂器ＳＲ改造戰場活潑攻擊％：', 'srPercent'],
    ['樂器裝備等級戰場活潑攻擊％：', 'gradePercent'],
    '【角色裝備賦予、農場物、娃娃背包】',
    ['　　左飾品賦予音樂技能效果：', 'enchantLeft'],
    ['　　右飾品賦予音樂技能效果：', 'enchantRight'],
    ['　　　頭部賦予音樂技能效果：', 'enchantHead'],
    ['　　　身體賦予音樂技能效果：', 'enchantBody'],
    ['　　　手部賦予音樂技能效果：', 'enchantHand'],
    ['　　　腳部賦予音樂技能效果：', 'enchantFoot'],
    ['　　　翅膀賦予音樂技能效果：', 'enchantWing'],
    ['　　　　農場物音樂技能效果：', 'farmEffect'],
    ['　　　娃娃背包音樂技能效果：', 'dollEffect'],
    '　▲音樂效果▲　▼持續時間▼',
    ['　頭部賦予音樂增益持續時間：', 'durationHead'],
    ['　身體賦予音樂增益持續時間：', 'durationBody'],
    ['　翅膀賦予音樂增益持續時間：', 'durationWing'],
    ['　娃娃背包音樂增益持續時間：', 'dollDuration'],
    '【調整參數 (聖水、圖騰、草冠，根據個人需要自行調整)】',
    ['　　　　　音樂效果技能效果：', 'adjEffect'],
    ['　　　　　音樂增益持續時間：', 'adjDuration'],
    ['　　　　　戰場活潑攻擊力％：', 'adjAttack'],
    '【切裝設定值 (自行調整，沒有對應音樂切裝時全部填0)】',
    ['　　　活潑板音樂效果減少值：', 'swap1'],
    ['　活潑板細工天籟效果減少值：', 'swap2'],
    ['　　　進行曲音樂效果減少值：', 'swap3'],
    ['　進行曲細工天籟效果減少值：', 'swap4'],
    '【請右鍵完整複製文字，修改數值後貼上並輸出，這行不要刪，會報錯】',
];

// musicAnalysis.test.ts — 音樂分析 pure logic: gear extraction, effect model, 普洛貓 text.
import { describe, it, expect } from 'vitest';
import { defaultAuto, defaultManual, renderProcat, gearInputs, type MusicInputs, type WornItem } from './musicAnalysis';
import { compute, formatDuration } from './musicAnalysis';
import { loadManual, saveManual, MANUAL_STORAGE_KEY } from './musicAnalysis';
import type { IndexItem } from './itemIndex';

// The user-supplied sample; renderProcat must reproduce it byte for byte.
export const SAMPLE_TEXT = `!music
【角色細工(自己算總和，max(身體所有部位細工總和,回音) )，優演比例例外】
　　　　　　　樂器演奏效果：20
　音樂知識天籟之音演奏效果：16
　音樂知識天籟之音演奏比例：6
　　音樂知識優秀的演奏效果：0
　回音音樂知識優秀演奏比例：0
　樂器音樂知識優秀演奏比例：0
　左飾品音樂知識優演奏比例：0
　右飾品音樂知識優演奏比例：0
　　　音樂知識普通演奏效果：0
　　　　戰場的序曲持續時間：0
　　　　　　活潑板持續時間：0
　　　　　　活潑板ＸＸ速度：9
　　　　　　進行曲持續時間：0
　　　　進行曲徒步移動速度：9
　　　　進行曲寵物移動速度：0
【角色稱號效果 (第一稱號 + 第二稱號)】
　　　　戰場的序曲技能效果：8
　　　　　　　　活潑板效果：8
　　　　　　　　進行曲效果：8
　　　　　　　音樂技能效果：10
　　　　　音樂效果持續時間：13
【角色裝備狀態 (1:發動  0:未發動)】
　　　　特別的優雅絲緞翅膀：0
　　吟遊詩人浪漫假髮與帽子：0
　　　特別吟遊詩人浪漫服裝：0
　　　　　吟遊詩人浪漫鞋子：1
　　　　熾天使歌唱手部裝飾：0
　　　　　　祕法聖詠者啓用：1
　一代宗師吟遊詩人效果啓用：1
　情侶同步手部服裝效果發動：0
　　　紅炎的精靈龍召喚狀態：1
　　　蒼冰的精靈龍召喚狀態：1
　　　　原初精靈龍召喚狀態：0
　　　　　　　音樂強化藥水：0
　　　　　　柯勒斐雷的喇叭：0
　充滿大祝福的柯勒斐雷喇叭：0
　　　卡片神諭戀人音樂效果：0
　　　卡片神諭戰車戰場時間：0
　　　卡片神諭太陽活潑時間：0
【角色其他狀態 (打數字)】
　　好奇心的和聲　０～７　：0
　戰場序曲魔法陣　０～１０：0
　　活潑板魔法陣　０～１０：0
　　進行曲魔法陣　０～１０：0
【角色樂器】
　　　樂器改造音樂技能效果：25
　　　樂器賦予音樂技能效果：6
　樂器改造音樂增益持續時間：5
　樂器賦予音樂增益持續時間：10
樂器ＳＲ改造戰場活潑攻擊％：4.5
樂器裝備等級戰場活潑攻擊％：7
【角色裝備賦予、農場物、娃娃背包】
　　左飾品賦予音樂技能效果：3
　　右飾品賦予音樂技能效果：2
　　　頭部賦予音樂技能效果：3
　　　身體賦予音樂技能效果：9
　　　手部賦予音樂技能效果：2
　　　腳部賦予音樂技能效果：2
　　　翅膀賦予音樂技能效果：5
　　　　農場物音樂技能效果：8
　　　娃娃背包音樂技能效果：1
　▲音樂效果▲　▼持續時間▼
　頭部賦予音樂增益持續時間：10
　身體賦予音樂增益持續時間：10
　翅膀賦予音樂增益持續時間：3
　娃娃背包音樂增益持續時間：6
【調整參數 (聖水、圖騰、草冠，根據個人需要自行調整)】
　　　　　音樂效果技能效果：7
　　　　　音樂增益持續時間：0
　　　　　戰場活潑攻擊力％：0
【切裝設定值 (自行調整，沒有對應音樂切裝時全部填0)】
　　　活潑板音樂效果減少值：3
　活潑板細工天籟效果減少值：6
　　　進行曲音樂效果減少值：7
　進行曲細工天籟效果減少值：6
【請右鍵完整複製文字，修改數值後貼上並輸出，這行不要刪，會報錯】`;

// The inputs behind SAMPLE_TEXT (shared with the compute tests in Task 2).
export function sampleInputs(): MusicInputs {
    return {
        auto: {
            ...defaultAuto(),
            playEffect: 20, inspEffect: 16, inspRatio: 6, livelySpeed: 9, marchWalk: 9,
            romanceShoes: 1,
            instrumentUpgrade: 25, instrumentEnchant: 6, instrumentUpgradeDuration: 5, instrumentEnchantDuration: 10,
            srPercent: 4.5, gradePercent: 7,
            enchantLeft: 3, enchantRight: 2, enchantHead: 3, enchantBody: 9, enchantHand: 2, enchantFoot: 2, enchantWing: 5,
            durationHead: 10, durationBody: 10, durationWing: 3,
        },
        manual: {
            ...defaultManual(),
            titleBattle: 8, titleLively: 8, titleMarch: 8, titleMusic: 10, titleDuration: 13,
            arcana: true, master: true, dragonRed: true, dragonBlue: true,
            farmEffect: 8, dollEffect: 1, dollDuration: 6,
            adjEffect: 7,
            swap1: 3, swap2: 6, swap3: 7, swap4: 6,
        },
    };
}

describe('renderProcat', () => {
    it('reproduces the user sample byte for byte', () => {
        expect(renderProcat(sampleInputs())).toBe(SAMPLE_TEXT);
    });
    it('renders zeros for default inputs and keeps the trailing guard line', () => {
        const out = renderProcat({ auto: defaultAuto(), manual: defaultManual() });
        const lines = out.split('\n');
        expect(lines[0]).toBe('!music');
        expect(lines[lines.length - 1]).toBe('【請右鍵完整複製文字，修改數值後貼上並輸出，這行不要刪，會報錯】');
        expect(lines.filter(l => l.includes('：')).every(l => l.endsWith('：0'))).toBe(true);
        expect(lines.length).toBe(SAMPLE_TEXT.split('\n').length);
    });
    it('falls back to 0 for non-finite or non-numeric values', () => {
        const inp = sampleInputs();
        inp.auto.srPercent = Number.NaN;
        (inp.manual as unknown as Record<string, unknown>).harmony = 'abc';
        const lines = renderProcat(inp).split('\n');
        expect(lines.find(l => l.startsWith('樂器ＳＲ改造戰場活潑攻擊％：'))).toBe('樂器ＳＲ改造戰場活潑攻擊％：0');
        expect(lines.find(l => l.startsWith('　　好奇心的和聲　０～７　：'))).toBe('　　好奇心的和聲　０～７　：0');
    });
});

const zero = (): MusicInputs => ({ auto: defaultAuto(), manual: defaultManual() });
const song = (r: ReturnType<typeof compute>, key: string) => r.songs.find(s => s.key === key)!;
const out = (r: ReturnType<typeof compute>, s: string, o: string) => song(r, s).outputs.find(x => x.key === o)!.values;

describe('compute: pool and outputs', () => {
    it('all-zero inputs at R1: pool 30, battle 26/28.6/33.8', () => {
        const r = compute(zero());
        expect(song(r, 'battle').pool).toBe(30);
        const v = out(r, 'battle', 'maxDamage');
        expect(v.normal).toBeCloseTo(26, 6);
        expect(v.excellent).toBeCloseTo(28.6, 6);
        expect(v.inspiring).toBeCloseTo(33.8, 6);
    });
    it('練習 rank uses RF base and skill value 0', () => {
        const i = zero();
        i.manual.rankBattle = 15; i.manual.rankPlay = 15; i.manual.rankSing = 15;
        const r = compute(i);
        expect(song(r, 'battle').pool).toBe(0);
        expect(out(r, 'battle', 'maxDamage').normal).toBeCloseTo(10, 6);
    });
    it('song-specific bonuses land in their own pool only', () => {
        const i = zero();
        i.auto.seraphHand = 1; i.auto.romanceHat = 1; i.auto.romanceShoes = 1;
        i.manual.titleBattle = 8; i.manual.titleLively = 7; i.manual.titleMarch = 6; i.manual.titleMusic = 10;
        const r = compute(i);
        expect(song(r, 'battle').pool).toBe(30 + 10 + 8 + 5);
        expect(song(r, 'lively').pool).toBe(30 + 10 + 7 + 3);
        expect(song(r, 'march').pool).toBe(30 + 10 + 6 + 3);
    });
    it('flat bonuses: wing, couple, arcana, master, potion, lover card, any dragon, horns', () => {
        const i = zero();
        i.auto.silkWing = 1;
        Object.assign(i.manual, { couple: true, arcana: true, master: true, potion: true, cardLover: true, dragonOrigin: true, hornBlessed: true });
        expect(song(compute(i), 'battle').pool).toBe(30 + 1 + 1 + 3 + 5 + 2 + 2 + 3 + 5);
        i.manual.hornBlessed = false; i.manual.hornNormal = true;
        expect(song(compute(i), 'battle').pool).toBe(30 + 1 + 1 + 3 + 5 + 2 + 2 + 3 + 2);
    });
    it('gear numbers add linearly: instrument, enchants, farm, doll, play-effect metalware, adjustment', () => {
        const i = zero();
        Object.assign(i.auto, { instrumentUpgrade: 25, instrumentEnchant: 6, playEffect: 20,
            enchantLeft: 3, enchantRight: 2, enchantHead: 3, enchantBody: 9, enchantHand: 2, enchantFoot: 2, enchantWing: 5 });
        Object.assign(i.manual, { farmEffect: 8, dollEffect: 1, adjEffect: 7 });
        expect(song(compute(i), 'battle').pool).toBe(30 + 25 + 6 + 20 + 26 + 8 + 1 + 7);
    });
    it('grade multipliers add metalware effect levels', () => {
        const i = zero();
        Object.assign(i.auto, { normalEffect: 4, excelEffect: 5, inspEffect: 10 });
        const v = out(compute(i), 'battle', 'maxDamage');
        expect(v.normal).toBeCloseTo(20 * 1.3 * 1.04, 6);
        expect(v.excellent).toBeCloseTo(20 * 1.3 * 1.15, 6);
        expect(v.inspiring).toBeCloseTo(20 * 1.3 * 1.40, 6);
    });
    it('extra multiplies damage outputs only', () => {
        const i = zero();
        i.auto.srPercent = 4.5; i.auto.gradePercent = 7; i.manual.adjAttack = 1;
        const r = compute(i);
        expect(out(r, 'battle', 'maxDamage').normal).toBeCloseTo(26 * 1.125, 6);
        expect(out(r, 'lively', 'magicAttack').normal).toBeCloseTo(26 * 1.125, 6);
        expect(out(r, 'lively', 'attackSpeed').normal).toBeCloseTo(11 * 1.3, 6);
        expect(out(r, 'march', 'walkSpeed').normal).toBeCloseTo(12 * 1.3, 6);
    });
    it('dragon: matching colour adds 2% of base before extra; others only +3 in the pool', () => {
        const i = zero();
        i.manual.dragonRed = true; i.auto.srPercent = 4.5;
        const r = compute(i);
        // pool 33: (20*1.33 + 0.4) * 1.045
        expect(out(r, 'battle', 'maxDamage').normal).toBeCloseTo((20 * 1.33 + 0.4) * 1.045, 6);
        expect(out(r, 'lively', 'magicAttack').normal).toBeCloseTo(20 * 1.33 * 1.045, 6);
        const j = zero(); j.manual.dragonBlue = true;
        expect(out(compute(j), 'lively', 'attackSpeed').normal).toBeCloseTo(11 * 1.33 + 0.22, 6);
        expect(out(compute(j), 'march', 'walkSpeed').normal).toBeCloseTo(12 * 1.33, 6);
    });
    it('speed metalware levels add to base', () => {
        const i = zero();
        i.auto.livelySpeed = 9; i.auto.marchWalk = 9; i.auto.marchRide = 2;
        const r = compute(i);
        expect(out(r, 'lively', 'magicSpeed').normal).toBeCloseTo(20 * 1.3, 6);
        expect(out(r, 'march', 'walkSpeed').normal).toBeCloseTo(21 * 1.3, 6);
        expect(out(r, 'march', 'rideSpeed').normal).toBeCloseTo(11 * 1.3, 6);
    });
});

describe('compute: grade ratio', () => {
    it('all zero: 15/296, 75/296, rest', () => {
        const r = compute(zero()).ratio;
        expect(r.inspiring).toBeCloseTo(15 / 296, 9);
        expect(r.excellent).toBeCloseTo(75 / 296, 9);
        expect(r.normal).toBeCloseTo(1 - 15 / 296 - 75 / 296, 9);
    });
    it('instrument+accessories beat echo when echo is not strictly larger', () => {
        const i = zero();
        Object.assign(i.auto, { inspRatio: 6, excelRatioEcho: 3, excelRatioInstrument: 1, excelRatioLeft: 1, excelRatioRight: 1 });
        const A = 6, B = (3 + 2) * 3;
        const r = compute(i).ratio;
        expect(r.inspiring).toBeCloseTo((15 + A * 296 / 30) / (296 + (A + B) * 296 / 30), 9);
        expect(r.excellent).toBeCloseTo((75 + B * 296 / 30) / (296 + (A + B) * 296 / 30), 9);
    });
    it('echo wins alone when strictly larger than the other three', () => {
        const i = zero();
        Object.assign(i.auto, { excelRatioEcho: 4, excelRatioInstrument: 1, excelRatioLeft: 1, excelRatioRight: 1 });
        const B = 3 + 2 * 4;
        expect(compute(i).ratio.excellent).toBeCloseTo((75 + B * 296 / 30) / (296 + B * 296 / 30), 9);
    });
    it('arcana scales A and B by 10; wing adds 2 to A; caps', () => {
        const i = zero();
        i.auto.inspRatio = 10; i.auto.silkWing = 1; i.manual.arcana = true;   // A = 120 → cap
        expect(compute(i).ratio).toEqual({ inspiring: 1, excellent: 0, normal: 0 });
        const j = zero();
        Object.assign(j.auto, { excelRatioInstrument: 7, excelRatioLeft: 7, excelRatioRight: 7 }); j.manual.arcana = true; // B = 17*3*10 = 510
        expect(compute(j).ratio).toEqual({ inspiring: 0, excellent: 1, normal: 0 });
    });
});

describe('compute: durations', () => {
    it('base 60 s and 圖安 ×3', () => {
        const s = song(compute(zero()), 'battle');
        expect(s.durationSec).toBe(60);
        expect(s.tuanSec).toBe(180);
    });
    it('adds every term for its own song', () => {
        const i = zero();
        Object.assign(i.auto, { battleDuration: 5, livelyDuration: 2, marchDuration: 1, silkWing: 1, romanceShoes: 1,
            instrumentUpgradeDuration: 5, instrumentEnchantDuration: 10, durationHead: 10, durationBody: 10, durationWing: 3 });
        Object.assign(i.manual, { master: true, arcana: true, couple: true, titleDuration: 13, dollDuration: 6, adjDuration: 4 });
        const common = 60 + 30 + 13 + 30 + 180 + 2 + 10 + 5 + 10 + 10 + 10 + 3 + 6 + 4;
        const r = compute(i);
        expect(song(r, 'battle').durationSec).toBe(common + 25);
        expect(song(r, 'lively').durationSec).toBe(common + 10);
        expect(song(r, 'march').durationSec).toBe(common + 5);
    });
    it('formatDuration rounds seconds and carries 60', () => {
        expect(formatDuration(60)).toBe('1分0秒');
        expect(formatDuration(425)).toBe('7分5秒');
        expect(formatDuration(119.6)).toBe('2分0秒');
    });
});

describe('compute: sample inputs', () => {
    it('matches the hand calculation for the user sample', () => {
        const r = compute(sampleInputs());
        // pool(battle) = 30 + 25 + 6 + 20 + (3+2+3+9+2+2+5) + 8 + 1 + 10 + 7 + 3 + 5 + 3 + 8 = 152
        expect(song(r, 'battle').pool).toBe(152);
        // (20 * 2.52 * 1.3 + 0.4) * 1.115
        expect(out(r, 'battle', 'maxDamage').inspiring).toBeCloseTo((20 * 2.52 * (1.3 + 0.16) + 0.4) * 1.115, 6);
        // pool(lively) = 152 - 8 + 8 = 152 as well (title 8, no hat)
        expect(song(r, 'lively').pool).toBe(152);
        expect(out(r, 'lively', 'attackSpeed').normal).toBeCloseTo((11 + 9) * 2.52 + (11 + 9) * 0.02, 6);
        // duration(battle) = 60 + 0 + 30 + 13 + 180 + 10 + 5 + 10 + 10 + 10 + 3 + 6 = 337
        expect(song(r, 'battle').durationSec).toBe(337);
    });
});

function it_(pocket: number, id: number, extra: Partial<IndexItem> = {}): WornItem {
    return { pocket, item: { id, qty: 1, storage: '', container: '', x: 0, y: 0, ...extra } };
}
const NAMES: Record<number, string> = {
    1: '木笛', 2: '靈魂解放者里拉', 3: '特別的優雅絲緞翅膀(魔力賦予)', 4: '吟遊詩人浪漫鞋子(女性用)',
    5: '熾天使歌唱手部裝飾(男性用)', 6: '特別吟遊詩人浪漫長版服裝(男性用)', 7: '吟遊詩人浪漫假髮與帽子(女性用)', 8: '回音石', 9: '皮手套',
};
const deps = (instrumentPocket = 10) => ({
    itemName: (id: number) => NAMES[id] ?? `Item ${id}`,
    upgradeName: (id: number) => (id === 17001 ? '調整旋律 1' : id === 51474 ? '調整旋律 1' : undefined),
    instrumentPocket,
});

describe('gearInputs: metalware merge rules', () => {
    it('rule A takes max(body sum, echo sum) and records both', () => {
        const items = [
            it_(5, 9, { metalware: [{ id: 1000307, level: 6 }] }),
            it_(6, 9, { metalware: [{ id: 1000307, level: 5 }] }),
            it_(62, 8, { metalware: [{ id: 1000307, level: 20 }] }),
            it_(63, 8, { metalware: [{ id: 1000606, level: 4 }] }),
            it_(64, 8, { metalware: [{ id: 1000606, level: 3 }] }),
            it_(8, 9, { metalware: [{ id: 1000606, level: 10 }] }),
        ];
        const a = gearInputs(items, deps());
        expect(a.playEffect).toBe(20);
        expect(a.detail.playEffect).toBe('身上 11 / 回音 20');
        expect(a.inspEffect).toBe(10);
        expect(a.detail.inspEffect).toBe('身上 10 / 回音 7');
    });
    it('rule B keeps 優秀比例 per source', () => {
        const items = [
            it_(62, 8, { metalware: [{ id: 1000602, level: 2 }] }),
            it_(63, 8, { metalware: [{ id: 1000602, level: 1 }] }),
            it_(10, 1, { metalware: [{ id: 1000602, level: 4 }] }),
            it_(16, 9, { metalware: [{ id: 1000602, level: 3 }] }),
            it_(17, 9, { metalware: [{ id: 1000602, level: 1 }] }),
        ];
        const a = gearInputs(items, deps());
        expect([a.excelRatioEcho, a.excelRatioInstrument, a.excelRatioLeft, a.excelRatioRight]).toEqual([3, 4, 3, 1]);
    });
    it('the inactive weapon set is not body', () => {
        const items = [
            it_(10, 1, { metalware: [{ id: 1000307, level: 3 }] }),
            it_(11, 1, { metalware: [{ id: 1000307, level: 9 }] }),
            it_(14, 9, { metalware: [{ id: 1000307, level: 9 }] }),
        ];
        expect(gearInputs(items, deps(10)).playEffect).toBe(3);
        expect(gearInputs(items, deps(11)).playEffect).toBe(18);   // 11 + 14 are both active in set II
    });
    it('活潑板ＸＸ速度 is the max over the three speed lines; durations and march lines are levels', () => {
        const items = [
            it_(5, 9, { metalware: [{ id: 5310305, level: 1 }, { id: 5310307, level: 3 }, { id: 5310103, level: 5 }, { id: 5310605, level: 2 }, { id: 5310606, level: 1 }, { id: 5310303, level: 2 }, { id: 5310603, level: 1 }] }),
        ];
        const a = gearInputs(items, deps());
        expect(a.livelySpeed).toBe(3);
        expect([a.battleDuration, a.livelyDuration, a.marchDuration, a.marchWalk, a.marchRide]).toEqual([5, 2, 1, 2, 1]);
    });
});

describe('gearInputs: enchants', () => {
    it('sums 113 per slot including conditional lines, 114 for durations', () => {
        const items = [
            it_(16, 9, { prefixEffects: [{ code: 113, value: 1 }], suffixEffects: [{ code: 113, value: 2, condSkill: 10003 }] }),
            it_(17, 9, { suffixEffects: [{ code: 113, value: 2 }] }),
            it_(8, 9, { prefixEffects: [{ code: 113, value: 3 }, { code: 114, value: 10 }, { code: 16, value: 5 }] }),
            it_(5, 9, { prefixEffects: [{ code: 113, value: 9 }], suffixEffects: [{ code: 114, value: 10 }] }),
            it_(6, 9, { prefixEffects: [{ code: 113, value: 2 }] }),
            it_(7, 9, { suffixEffects: [{ code: 113, value: 2 }] }),
            it_(9, 3, { prefixEffects: [{ code: 113, value: 5 }, { code: 114, value: 3 }] }),
        ];
        const a = gearInputs(items, deps());
        expect([a.enchantLeft, a.enchantRight, a.enchantHead, a.enchantBody, a.enchantHand, a.enchantFoot, a.enchantWing]).toEqual([3, 2, 3, 9, 2, 2, 5]);
        expect([a.durationHead, a.durationBody, a.durationWing]).toEqual([10, 10, 3]);
        expect(a.detail.enchantLeft).toBe('賦予 +1, +2(條件)');
    });
    it('holy-water hint sums 113 on blessEffects', () => {
        const items = [it_(5, 9, { blessEffects: [{ code: 113, value: 1 }] }), it_(6, 9, { blessEffects: [{ code: 113, value: 2 }] })];
        expect(gearInputs(items, deps()).holyWaterHint).toBe(3);
    });
});

describe('gearInputs: instrument', () => {
    it('upgrade 113/114 from UPR, inherent by name, SR and grade from metadata', () => {
        const items = [it_(10, 2, {
            metadata: 'UPR1:s:17001,113,1;UPR2:s:17001,113,2;UPR3:s:99,114,5;EHLV:4:7;IMRBV:f:7;',
            prefixEffects: [{ code: 113, value: 6 }], suffixEffects: [{ code: 114, value: 10 }],
        })];
        const a = gearInputs(items, deps());
        expect(a.instrumentUpgrade).toBe(22 + 3);
        expect(a.instrumentUpgradeDuration).toBe(5);
        expect(a.instrumentEnchant).toBe(6);
        expect(a.instrumentEnchantDuration).toBe(10);
        expect(a.srPercent).toBe(4.5);
        expect(a.gradePercent).toBe(7);
        expect(a.detail.instrumentUpgrade).toBe('固有 22 + 改造 3');
    });
    it('unknown instrument with a 調整旋律 upgrade gets the default inherent 8; a non-instrument gets 0', () => {
        const flute = [it_(10, 1, { metadata: 'UPR1:s:51474,113,1;' })];
        expect(gearInputs(flute, deps()).instrumentUpgrade).toBe(9);
        expect(gearInputs([], deps()).instrumentUpgrade).toBe(0);
    });
    it('a sword in the main hand does not feed SR/裝備等級/賦予/改造-duration into the music model', () => {
        const sword = [it_(10, 9, {
            metadata: 'UPR1:s:12345,16,3;EHLV:4:7;IMRBV:f:56;',
            prefixEffects: [{ code: 113, value: 6 }],
        })];
        const a = gearInputs(sword, deps());
        expect(a.instrumentUpgrade).toBe(0);
        expect(a.instrumentEnchant).toBe(0);
        expect(a.srPercent).toBe(0);
        expect(a.gradePercent).toBe(0);
        expect(a.detail.srPercent).toBe('非樂器,不計');
    });
    it('plain instrument detected by name alone, with no metadata at all', () => {
        const flute = [it_(10, 1)];
        const a = gearInputs(flute, deps());
        expect(a.instrumentUpgrade).toBe(8);
        expect(a.instrumentUpgradeDuration).toBe(0);
        expect(a.srPercent).toBe(0);
        expect(a.gradePercent).toBe(0);
        expect(a.detail.instrumentUpgrade).toBe('固有 8 + 改造 0');
    });
    it('a non-instrument name with no metadata scores 0', () => {
        const gloves = [it_(10, 9)];
        const a = gearInputs(gloves, deps());
        expect(a.instrumentUpgrade).toBe(0);
        expect(a.detail.instrumentUpgrade).toBe('非樂器(固有 0)+ 改造 0');
    });
});

describe('gearInputs: set items', () => {
    it('flags worn set items by name', () => {
        const items = [it_(9, 3), it_(7, 4), it_(6, 5), it_(5, 6), it_(8, 7)];
        const a = gearInputs(items, deps());
        expect([a.silkWing, a.romanceShoes, a.seraphHand, a.romanceDress, a.romanceHat]).toEqual([1, 1, 1, 1, 1]);
        expect(gearInputs([it_(9, 9)], deps()).silkWing).toBe(0);
    });
    it('empty gear yields defaults', () => {
        expect(gearInputs([], deps())).toEqual({ ...defaultAuto(), detail: expect.any(Object) });
    });
});

describe('manual storage', () => {
    it('round-trips and merges defaults over a partial record', () => {
        const store: Record<string, string> = {};
        const ls = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
        (globalThis as unknown as { localStorage: typeof ls }).localStorage = ls;
        const m = { ...defaultManual(), master: true, titleMusic: 10 };
        saveManual(m);
        expect(JSON.parse(store[MANUAL_STORAGE_KEY]).master).toBe(true);
        store[MANUAL_STORAGE_KEY] = JSON.stringify({ titleMusic: 4 });
        expect(loadManual()).toEqual({ ...defaultManual(), titleMusic: 4 });
        store[MANUAL_STORAGE_KEY] = '{not json';
        expect(loadManual()).toEqual(defaultManual());
    });
});

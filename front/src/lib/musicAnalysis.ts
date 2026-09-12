// musicAnalysis.ts — 音樂分析 pure logic: gear → template inputs, the unified
// music-effect model, and the 普洛貓 !music text. See the 2026-09-08 spec.
import { parseItemMetadata, type IndexItem } from './itemIndex';
import {
    PROCAT_TEMPLATE, SONGS, SKILL_VALUE_BY_RANK, GRADE_BASE, BONUS, DURATION, RATIO,
    MW, ECHO_POCKETS, WEAPON_SETS, ENCHANT_MUSIC_EFFECT, ENCHANT_MUSIC_DURATION,
    SR_PERCENT, INSTRUMENT_BASE, INSTRUMENT_DEFAULT_BASE, TUNE_UPGRADE_NAME, INSTRUMENT_NAME_HINTS, SET_ITEM_RULES,
    type ProcatKey, type SongKey, type SongDef, type ReforgeLine,
} from './musicData';

// Fields filled from worn gear; metalware fields are levels, 1/0 flags are set items.
export interface AutoInputs {
    playEffect: number; inspEffect: number; inspRatio: number; excelEffect: number;
    excelRatioEcho: number; excelRatioInstrument: number; excelRatioLeft: number; excelRatioRight: number;
    normalEffect: number;
    battleDuration: number; livelyDuration: number; livelySpeed: number;
    marchDuration: number; marchWalk: number; marchRide: number;
    silkWing: 0 | 1; romanceHat: 0 | 1; romanceDress: 0 | 1; romanceShoes: 0 | 1; seraphHand: 0 | 1;
    instrumentUpgrade: number; instrumentEnchant: number;
    instrumentUpgradeDuration: number; instrumentEnchantDuration: number;
    srPercent: number; gradePercent: number;
    enchantLeft: number; enchantRight: number; enchantHead: number; enchantBody: number;
    enchantHand: number; enchantFoot: number; enchantWing: number;
    durationHead: number; durationBody: number; durationWing: number;
    holyWaterHint: number;                       // sum of 113 on blessEffects, shown as a hint only
    detail: Partial<Record<keyof AutoInputs, string>>;  // per-field source text for tooltips
}

// Fields the user fills; persisted in localStorage.
export interface ManualInputs {
    titleBattle: number; titleLively: number; titleMarch: number; titleMusic: number; titleDuration: number;
    arcana: boolean; master: boolean; couple: boolean;
    dragonRed: boolean; dragonBlue: boolean; dragonOrigin: boolean;
    potion: boolean; hornNormal: boolean; hornBlessed: boolean;
    cardLover: boolean; cardChariot: boolean; cardSun: boolean;
    harmony: number; circleBattle: number; circleLively: number; circleMarch: number;
    farmEffect: number; dollEffect: number; dollDuration: number;
    adjEffect: number; adjDuration: number; adjAttack: number;
    swap1: number; swap2: number; swap3: number; swap4: number;
    rankBattle: number; rankLively: number; rankMarch: number; rankPlay: number; rankSing: number;
}

export interface MusicInputs { auto: AutoInputs; manual: ManualInputs }

export function defaultAuto(): AutoInputs {
    return {
        playEffect: 0, inspEffect: 0, inspRatio: 0, excelEffect: 0,
        excelRatioEcho: 0, excelRatioInstrument: 0, excelRatioLeft: 0, excelRatioRight: 0,
        normalEffect: 0, battleDuration: 0, livelyDuration: 0, livelySpeed: 0,
        marchDuration: 0, marchWalk: 0, marchRide: 0,
        silkWing: 0, romanceHat: 0, romanceDress: 0, romanceShoes: 0, seraphHand: 0,
        instrumentUpgrade: 0, instrumentEnchant: 0, instrumentUpgradeDuration: 0, instrumentEnchantDuration: 0,
        srPercent: 0, gradePercent: 0,
        enchantLeft: 0, enchantRight: 0, enchantHead: 0, enchantBody: 0, enchantHand: 0, enchantFoot: 0, enchantWing: 0,
        durationHead: 0, durationBody: 0, durationWing: 0,
        holyWaterHint: 0, detail: {},
    };
}

export function defaultManual(): ManualInputs {
    return {
        titleBattle: 0, titleLively: 0, titleMarch: 0, titleMusic: 0, titleDuration: 0,
        arcana: false, master: false, couple: false,
        dragonRed: false, dragonBlue: false, dragonOrigin: false,
        potion: false, hornNormal: false, hornBlessed: false,
        cardLover: false, cardChariot: false, cardSun: false,
        harmony: 0, circleBattle: 0, circleLively: 0, circleMarch: 0,
        farmEffect: 0, dollEffect: 0, dollDuration: 0,
        adjEffect: 0, adjDuration: 0, adjAttack: 0,
        swap1: 0, swap2: 0, swap3: 0, swap4: 0,
        rankBattle: 0, rankLively: 0, rankMarch: 0, rankPlay: 0, rankSing: 0,
    };
}

// Flatten both input halves into the template's value space (booleans → 1/0).
export function procatValues(inp: MusicInputs): Record<ProcatKey, number> {
    const a = inp.auto, m = inp.manual;
    const b = (v: boolean) => (v ? 1 : 0);
    return {
        playEffect: a.playEffect, inspEffect: a.inspEffect, inspRatio: a.inspRatio, excelEffect: a.excelEffect,
        excelRatioEcho: a.excelRatioEcho, excelRatioInstrument: a.excelRatioInstrument,
        excelRatioLeft: a.excelRatioLeft, excelRatioRight: a.excelRatioRight,
        normalEffect: a.normalEffect, battleDuration: a.battleDuration, livelyDuration: a.livelyDuration,
        livelySpeed: a.livelySpeed, marchDuration: a.marchDuration, marchWalk: a.marchWalk, marchRide: a.marchRide,
        titleBattle: m.titleBattle, titleLively: m.titleLively, titleMarch: m.titleMarch,
        titleMusic: m.titleMusic, titleDuration: m.titleDuration,
        silkWing: a.silkWing, romanceHat: a.romanceHat, romanceDress: a.romanceDress,
        romanceShoes: a.romanceShoes, seraphHand: a.seraphHand,
        arcana: b(m.arcana), master: b(m.master), couple: b(m.couple),
        dragonRed: b(m.dragonRed), dragonBlue: b(m.dragonBlue), dragonOrigin: b(m.dragonOrigin),
        potion: b(m.potion), hornNormal: b(m.hornNormal), hornBlessed: b(m.hornBlessed),
        cardLover: b(m.cardLover), cardChariot: b(m.cardChariot), cardSun: b(m.cardSun),
        harmony: m.harmony, circleBattle: m.circleBattle, circleLively: m.circleLively, circleMarch: m.circleMarch,
        instrumentUpgrade: a.instrumentUpgrade, instrumentEnchant: a.instrumentEnchant,
        instrumentUpgradeDuration: a.instrumentUpgradeDuration, instrumentEnchantDuration: a.instrumentEnchantDuration,
        srPercent: a.srPercent, gradePercent: a.gradePercent,
        enchantLeft: a.enchantLeft, enchantRight: a.enchantRight, enchantHead: a.enchantHead, enchantBody: a.enchantBody,
        enchantHand: a.enchantHand, enchantFoot: a.enchantFoot, enchantWing: a.enchantWing,
        farmEffect: m.farmEffect, dollEffect: m.dollEffect,
        durationHead: a.durationHead, durationBody: a.durationBody, durationWing: a.durationWing, dollDuration: m.dollDuration,
        adjEffect: m.adjEffect, adjDuration: m.adjDuration, adjAttack: m.adjAttack,
        swap1: m.swap1, swap2: m.swap2, swap3: m.swap3, swap4: m.swap4,
    };
}

// Numbers print as JS does (4.5 stays 4.5, 7 stays 7); NaN/non-numeric become 0.
const num = (v: number): string => { const n = Number(v); return Number.isFinite(n) ? String(n) : '0'; };

export function renderProcat(inp: MusicInputs): string {
    const v = procatValues(inp);
    return PROCAT_TEMPLATE.map(line => (typeof line === 'string' ? line : line[0] + num(v[line[1]]))).join('\n');
}

// A worn item plus its inventory pocket, as consumed by gearInputs below.
export type WornItem = { pocket: number; item: IndexItem };

export interface GradeValues { normal: number; excellent: number; inspiring: number }
export interface SongOutputResult { key: string; label: string; base: number; values: GradeValues }
export interface SongResult {
    key: SongKey; label: string; pool: number;
    outputs: SongOutputResult[];
    durationSec: number; tuanSec: number;
}
export interface MusicResult { songs: SongResult[]; ratio: GradeValues; extra: number }

const RANK_OF: Record<SongKey, keyof ManualInputs> = { battle: 'rankBattle', lively: 'rankLively', march: 'rankMarch' };
const DURATION_LV: Record<SongKey, keyof AutoInputs> = { battle: 'battleDuration', lively: 'livelyDuration', march: 'marchDuration' };
const REFORGE_LV: Record<ReforgeLine, keyof AutoInputs> = { livelySpeed: 'livelySpeed', marchWalk: 'marchWalk', marchRide: 'marchRide' };

// Music-effect pool E for one song: everything that adds linearly (spec 3.1).
function pool(song: SongDef, inp: MusicInputs): number {
    const a = inp.auto, m = inp.manual;
    let e = SKILL_VALUE_BY_RANK[m.rankPlay] + SKILL_VALUE_BY_RANK[m.rankSing]
        + a.instrumentUpgrade + a.instrumentEnchant
        + a.enchantLeft + a.enchantRight + a.enchantHead + a.enchantBody + a.enchantHand + a.enchantFoot + a.enchantWing
        + m.farmEffect + m.dollEffect + m.titleMusic + a.playEffect + m.adjEffect
        + a.silkWing * BONUS.silkWing
        + (m.couple ? BONUS.couple : 0) + (m.arcana ? BONUS.arcana : 0) + (m.master ? BONUS.master : 0)
        + (m.potion ? BONUS.potion : 0) + (m.cardLover ? BONUS.cardLover : 0)
        + (m.dragonRed || m.dragonBlue || m.dragonOrigin ? BONUS.dragonAny : 0)
        + (m.hornBlessed ? BONUS.hornBlessed : m.hornNormal ? BONUS.hornNormal : 0);
    if (song.key === 'battle') e += m.titleBattle + a.seraphHand * BONUS.seraphHand + a.romanceDress * BONUS.romanceDress;
    if (song.key === 'lively') e += m.titleLively + a.romanceHat * BONUS.romanceHat;
    if (song.key === 'march') e += m.titleMarch + a.romanceShoes * BONUS.romanceShoes;
    return e;
}

function dragonMatches(song: SongDef, m: ManualInputs): boolean {
    return (song.dragonColor === 'red' && m.dragonRed) || (song.dragonColor === 'blue' && m.dragonBlue);
}

// Grade ratio: A (天籟) vs B (優秀), echo wins alone only when strictly larger (spec 3.4).
function gradeRatio(inp: MusicInputs): GradeValues {
    const a = inp.auto;
    const scale = inp.manual.arcana ? 10 : 1;
    const A = (a.inspRatio + a.silkWing * RATIO.wingBonus) * scale;
    const b = (x: number) => (x === 0 ? 0 : 3 + 2 * x);
    const others = a.excelRatioInstrument + a.excelRatioLeft + a.excelRatioRight;
    const B = (a.excelRatioEcho > others ? b(a.excelRatioEcho) : b(a.excelRatioInstrument) + b(a.excelRatioLeft) + b(a.excelRatioRight)) * scale;
    const denom = 296 + (A + B) * RATIO.scale;
    const inspiring = A >= RATIO.inspiringCap ? 1 : B >= RATIO.excellentCap ? 0 : (RATIO.inspiringWeight + A * RATIO.scale) / denom;
    const excellent = A >= RATIO.inspiringCap ? 0 : B >= RATIO.excellentCap ? 1 : (RATIO.excellentWeight + B * RATIO.scale) / denom;
    return { inspiring, excellent, normal: 1 - inspiring - excellent };
}

function durationSec(song: SongDef, inp: MusicInputs): number {
    const a = inp.auto, m = inp.manual;
    return DURATION.base + DURATION.perLevel * (a[DURATION_LV[song.key]] as number)
        + (m.master ? DURATION.master : 0) + m.titleDuration
        + a.silkWing * DURATION.silkWing + (m.arcana ? DURATION.arcana : 0)
        + (m.couple ? DURATION.couple : 0) + a.romanceShoes * DURATION.romanceShoes
        + a.instrumentUpgradeDuration + a.instrumentEnchantDuration
        + a.durationHead + a.durationBody + a.durationWing + m.dollDuration + m.adjDuration;
}

export function compute(inp: MusicInputs): MusicResult {
    const a = inp.auto, m = inp.manual;
    const extra = 1 + 0.01 * (a.srPercent + a.gradePercent + m.adjAttack);
    const grade: GradeValues = {
        normal: GRADE_BASE.normal + 0.01 * a.normalEffect,
        excellent: GRADE_BASE.excellent + 0.01 * a.excelEffect,
        inspiring: GRADE_BASE.inspiring + 0.01 * a.inspEffect,
    };
    const songs = SONGS.map((song): SongResult => {
        const e = pool(song, inp);
        const rankIdx = Math.min(m[RANK_OF[song.key]] as number, song.outputs[0].base.length - 1);
        const outputs = song.outputs.map((o): SongOutputResult => {
            const base = o.base[rankIdx] + (o.reforge ? (a[REFORGE_LV[o.reforge]] as number) : 0);
            const dragon = o.dragon && dragonMatches(song, m) ? 0.02 * base : 0;
            const ex = o.extra ? extra : 1;
            const val = (g: number) => (base * (1 + 0.01 * e) * g + dragon) * ex;
            return { key: o.key, label: o.label, base, values: { normal: val(grade.normal), excellent: val(grade.excellent), inspiring: val(grade.inspiring) } };
        });
        const sec = durationSec(song, inp);
        return { key: song.key, label: song.label, pool: e, outputs, durationSec: sec, tuanSec: sec * DURATION.tuanFactor };
    });
    return { songs, ratio: gradeRatio(inp), extra };
}

// "m分s秒" with seconds rounded and carried into minutes.
export function formatDuration(sec: number): string {
    let min = Math.floor(sec / 60);
    let s = Math.round(sec - min * 60);
    if (s === 60) { min += 1; s = 0; }
    return `${min}分${s}秒`;
}

export interface GearDeps {
    itemName: (id: number) => string;
    upgradeName: (id: number) => string | undefined;
    instrumentPocket: number;   // 10 or 11, the board's selected weapon set
}

const SLOT_ENCHANT: [number, keyof AutoInputs, keyof AutoInputs | null][] = [
    [16, 'enchantLeft', null], [17, 'enchantRight', null], [8, 'enchantHead', 'durationHead'],
    [5, 'enchantBody', 'durationBody'], [6, 'enchantHand', null], [7, 'enchantFoot', null], [9, 'enchantWing', 'durationWing'],
];

type Effect = { code: number; value: number; condSkill?: number };
const effectsOf = (it: IndexItem): Effect[] => [...(it.prefixEffects ?? []), ...(it.suffixEffects ?? [])];
const sumCode = (list: Effect[], code: number) => list.filter(e => e.code === code).reduce((s, e) => s + e.value, 0);
const levelOf = (it: IndexItem, id: number) => (it.metalware ?? []).filter(m => m.id === id).reduce((s, m) => s + m.level, 0);

export function gearInputs(items: WornItem[], deps: GearDeps): AutoInputs {
    const a = defaultAuto();
    const inactive = new Set(WEAPON_SETS[deps.instrumentPocket === 11 ? 10 : 11]);
    const active = items.filter(w => !inactive.has(w.pocket));
    const body = active.filter(w => !ECHO_POCKETS.includes(w.pocket));
    const echo = active.filter(w => ECHO_POCKETS.includes(w.pocket));
    const sumLv = (list: WornItem[], id: number) => list.reduce((s, w) => s + levelOf(w.item, id), 0);

    // Rule A: max(body, echo); both numbers kept for the tooltip.
    const ruleA = (key: keyof AutoInputs, id: number) => {
        const b = sumLv(body, id), e = sumLv(echo, id);
        (a as unknown as Record<string, number>)[key] = Math.max(b, e);
        a.detail[key] = `身上 ${b} / 回音 ${e}`;
    };
    ruleA('playEffect', MW.playEffect); ruleA('inspEffect', MW.inspEffect); ruleA('inspRatio', MW.inspRatio);
    ruleA('excelEffect', MW.excelEffect); ruleA('normalEffect', MW.normalEffect);
    ruleA('battleDuration', MW.battleDuration); ruleA('livelyDuration', MW.livelyDuration); ruleA('marchDuration', MW.marchDuration);
    ruleA('marchWalk', MW.marchWalk); ruleA('marchRide', MW.marchRide);
    const speeds = [MW.livelyMagicSpeed, MW.livelyAlchemySpeed, MW.livelyAttackSpeed].map(id => Math.max(sumLv(body, id), sumLv(echo, id)));
    a.livelySpeed = Math.max(...speeds);
    a.detail.livelySpeed = `魔法 ${speeds[0]} / 鍊金 ${speeds[1]} / 攻擊 ${speeds[2]}`;

    // Rule B: 優秀比例 per source.
    const instrument = active.find(w => w.pocket === deps.instrumentPocket)?.item;
    const at = (pocket: number) => active.find(w => w.pocket === pocket)?.item;
    a.excelRatioEcho = sumLv(echo, MW.excelRatio);
    a.excelRatioInstrument = instrument ? levelOf(instrument, MW.excelRatio) : 0;
    a.excelRatioLeft = at(16) ? levelOf(at(16)!, MW.excelRatio) : 0;
    a.excelRatioRight = at(17) ? levelOf(at(17)!, MW.excelRatio) : 0;

    // Enchants per slot; conditional lines count as met.
    for (const [pocket, effKey, durKey] of SLOT_ENCHANT) {
        const it = at(pocket);
        if (!it) continue;
        const eff = effectsOf(it);
        (a as unknown as Record<string, number>)[effKey] = sumCode(eff, ENCHANT_MUSIC_EFFECT);
        const parts = eff.filter(e => e.code === ENCHANT_MUSIC_EFFECT).map(e => `+${e.value}${e.condSkill ? '(條件)' : ''}`);
        if (parts.length) a.detail[effKey] = `賦予 ${parts.join(', ')}`;
        if (durKey) (a as unknown as Record<string, number>)[durKey] = sumCode(eff, ENCHANT_MUSIC_DURATION);
    }
    a.holyWaterHint = active.reduce((s, w) => s + sumCode(w.item.blessEffects ?? [], ENCHANT_MUSIC_EFFECT), 0);

    // Instrument: UPR upgrades, inherent value by name (or 調整旋律/keyword detection),
    // enchants, SR, 裝備等級.
    if (instrument) {
        const meta = parseItemMetadata(instrument.metadata);
        let up = 0, upDur = 0, tuned = false;
        for (let i = 1; i <= 9; i++) {
            const f = (meta[`UPR${i}`] ?? '').split(',');
            if (f.length < 3) continue;
            const upId = Number(f[0]), code = Number(f[1]), v = Number(f[2]);
            if (!Number.isFinite(v)) continue;
            if (code === ENCHANT_MUSIC_EFFECT) up += v;
            if (code === ENCHANT_MUSIC_DURATION) upDur += v;
            if (deps.upgradeName(upId)?.startsWith(TUNE_UPGRADE_NAME)) tuned = true;
        }
        const name = deps.itemName(instrument.id);
        const known = INSTRUMENT_BASE.find(([sub]) => name.includes(sub));
        const isInstrument = !!known || tuned || INSTRUMENT_NAME_HINTS.some(k => name.includes(k));
        const inherent = known ? known[1] : isInstrument ? INSTRUMENT_DEFAULT_BASE : 0;
        if (!isInstrument) up = 0;   // a weapon's UPR lines are not instrument lines
        a.instrumentUpgrade = inherent + up;
        a.detail.instrumentUpgrade = isInstrument ? `固有 ${inherent} + 改造 ${up}` : `非樂器(固有 0)+ 改造 ${up}`;
        a.instrumentUpgradeDuration = isInstrument ? upDur : 0;
        const eff = effectsOf(instrument);
        a.instrumentEnchant = isInstrument ? sumCode(eff, ENCHANT_MUSIC_EFFECT) : 0;
        a.instrumentEnchantDuration = isInstrument ? sumCode(eff, ENCHANT_MUSIC_DURATION) : 0;
        // SR/裝備等級 only apply to instruments; a weapon's own bonuses must not leak in.
        if (isInstrument) {
            a.srPercent = SR_PERCENT[Number(meta.EHLV)] ?? 0;
            a.gradePercent = Number(meta.IMRBV) || 0;
        } else {
            a.srPercent = 0;
            a.gradePercent = 0;
            a.detail.srPercent = a.detail.gradePercent = '非樂器,不計';
        }
    }

    // Set items by name over every active slot.
    for (const rule of SET_ITEM_RULES) {
        const hit = active.find(w => rule.test(deps.itemName(w.item.id)));
        if (hit) { a[rule.key] = 1; a.detail[rule.key] = deps.itemName(hit.item.id); }
    }
    return a;
}

export const MANUAL_STORAGE_KEY = 'mogugi.musicAnalysis.v1';

export function loadManual(): ManualInputs {
    try {
        const raw = localStorage.getItem(MANUAL_STORAGE_KEY);
        if (raw) return { ...defaultManual(), ...JSON.parse(raw) };
    } catch { /* missing or corrupt storage → defaults */ }
    return defaultManual();
}

export function saveManual(m: ManualInputs): void {
    try { localStorage.setItem(MANUAL_STORAGE_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

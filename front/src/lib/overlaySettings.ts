import { loadSetting, saveSetting } from './settingsStorage';
import {
    defaultCcSection, defaultCooldownSection, defaultDpsLook, defaultGeneral, normalizeCcSection,
    normalizeCooldownSection, normalizeDpsLook, normalizeGeneral,
    type CcSection as CcSectionData, type CcSectionId, type CooldownSection, type DpsLook, type OverlayGeneral,
} from './overlaySections';

export type SizeStep = 's' | 'm' | 'l';

/** A tracked cooldown: started by a cast of `skillId`, or (ccId > 0) by the caster applying that CC. */
export interface CooldownSkill { skillId: number; cooldownSec: number; ccId: number }

export interface AlertsOverlaySettings { opacity: number; bg: string; fontSize: SizeStep }

export type AlertTarget = 'boss' | 'self' | 'party' | 'all';

/** countdown: at remaining seconds. periodic: every N seconds while the conditions hold. appear: when the CC starts. */
export type AlertKind = 'countdown' | 'periodic' | 'appear';
export interface AlertCond { mode: 'absent' | 'present'; ccId: number }
export interface AlertDismiss { condFails: boolean; ccEnds: boolean; replaced: boolean }

export interface AlertRule {
    id: string;
    enabled: boolean;
    kind: AlertKind;
    target: AlertTarget;
    /** Countdown and appear: the watched CC. Periodic: unused, 0. */
    ccId: number;
    /** Countdown: remaining-second points, descending. Periodic: empty. */
    times: number[];
    /** Periodic: seconds between checks. */
    every: number;
    conds: AlertCond[];
    join: 'and' | 'or';
    text: boolean;
    textMessage: string;
    voice: boolean;
    voiceMessage: string;
    /** Seconds a text alert stays. */
    textKeep: number;
    /** Shown large and highlighted. */
    loud: boolean;
    dismiss: AlertDismiss;
}

export interface VoiceSettings { voiceName: string; rate: number; volume: number; muted: boolean }

export interface OverlaySettings {
    v: typeof SETTINGS_VERSION;
    scale: number;
    general: OverlayGeneral;
    ccBoss: CcSectionData;
    ccSelf: CcSectionData;
    ccParty: CcSectionData;
    burst: CcSectionData;
    misc: CcSectionData;
    cooldown: CooldownSection;
    dpsLook: DpsLook;
    alerts: AlertsOverlaySettings;
    rules: AlertRule[];
    voice: VoiceSettings;
}

export const FONT_PX: Record<SizeStep, number> = { s: 12, m: 14, l: 16 };
export const DEFAULT_BG = '#0e1013';

/** Saved settings from an older version are replaced by the defaults. */
export const SETTINGS_VERSION = 2;

const PRELUDE = 680;
const LIVELY = 192;
const MARCH = 193;
const TUAN = 1124;

const rule = (o: Pick<AlertRule, 'id' | 'kind' | 'target' | 'ccId'> & Partial<AlertRule>): AlertRule => ({
    enabled: true, times: [], every: DEFAULT_EVERY, conds: [], join: 'and', text: true, textMessage: '',
    voice: false, voiceMessage: '', textKeep: 10, loud: false,
    dismiss: { condFails: false, ccEnds: true, replaced: false }, ...o,
});
const music = (id: string, ccId: number) => rule({
    id, kind: 'countdown', target: 'self', ccId, times: [30], conds: [{ mode: 'absent', ccId: TUAN }],
    textMessage: '{CC} 剩 {秒} 秒，沒有圖安之魂', voice: true, voiceMessage: '{CC}剩{秒}秒，沒有圖安',
    dismiss: { condFails: true, ccEnds: true, replaced: false },
});
const bossDebuff = (id: string, ccId: number) => rule({ id, kind: 'countdown', target: 'boss', ccId, times: [30] });

/** The rules mogugi starts with; ids are fixed so 恢復預設 can tell which are missing. */
export function defaultRules(): AlertRule[] {
    // Shipped off: each player turns on the ones they want.
    return [
        music('d-prelude', PRELUDE),
        music('d-lively', LIVELY),
        music('d-march', MARCH),
        bossDebuff('d-def', 1164),
        bossDebuff('d-mdef', 1165),
        bossDebuff('d-dmg', 1166),
    ].map(r => ({ ...r, enabled: false }));
}

export function defaultOverlaySettings(): OverlaySettings {
    return {
        v: SETTINGS_VERSION,
        scale: 100,
        general: defaultGeneral(),
        ccBoss: defaultCcSection('ccBoss'),
        ccSelf: defaultCcSection('ccSelf'),
        ccParty: defaultCcSection('ccParty'),
        burst: defaultCcSection('burst'),
        misc: defaultCcSection('misc'),
        cooldown: defaultCooldownSection(),
        dpsLook: defaultDpsLook(),
        alerts: { opacity: 60, bg: DEFAULT_BG, fontSize: 'm' },
        rules: defaultRules(),
        voice: { voiceName: '', rate: 1.2, volume: 100, muted: false },
    };
}

const rec = (v: unknown): Record<string, unknown> =>
    typeof v === 'object' && v !== null ? v as Record<string, unknown> : {};

const bool = (v: unknown, fb: boolean): boolean => typeof v === 'boolean' ? v : fb;

const step = (v: unknown, fb: SizeStep): SizeStep => v === 's' || v === 'm' || v === 'l' ? v : fb;

function opacity(v: unknown, fb: number): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fb;
    return Math.min(100, Math.max(0, Math.round(v)));
}

const color = (v: unknown, fb: string): string =>
    typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fb;

function num(v: unknown, fb: number, lo: number, hi: number): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fb;
    return Math.min(hi, Math.max(lo, v));
}

const posInt = (v: unknown): number | null =>
    typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;

const DEFAULT_EVERY = 30;
const DEFAULT_TEXT_KEEP = 5;

function intIn(v: unknown, fb: number, lo: number, hi: number): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fb;
    return Math.min(hi, Math.max(lo, Math.round(v)));
}

function normalizeConds(v: unknown): AlertCond[] {
    if (!Array.isArray(v)) return [];
    const out: AlertCond[] = [];
    for (const x of v) {
        const c = rec(x);
        const ccId = posInt(c.ccId);
        if ((c.mode === 'absent' || c.mode === 'present') && ccId !== null) out.push({ mode: c.mode, ccId });
    }
    return out;
}

function normalizeRule(v: unknown): AlertRule | null {
    const r = rec(v);
    const target = r.target;
    const kind = r.kind;
    if (typeof r.id !== 'string' || r.id === '') return null;
    if (kind !== 'countdown' && kind !== 'periodic' && kind !== 'appear') return null;
    if (target !== 'boss' && target !== 'self' && target !== 'party' && target !== 'all') return null;
    let ccId = 0;
    let times: number[] = [];
    if (kind !== 'periodic') {
        const id = posInt(r.ccId);
        if (id === null) return null;
        ccId = id;
    }
    if (kind === 'countdown') {
        times = Array.isArray(r.times)
            ? [...new Set(r.times
                .filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0)
                .map(x => Math.round(x))
                .filter(x => x > 0))].sort((a, b) => b - a)
            : [];
        if (times.length === 0) return null;
    }
    const d = rec(r.dismiss);
    return {
        id: r.id,
        enabled: bool(r.enabled, true),
        kind,
        target,
        ccId,
        times,
        every: intIn(r.every, DEFAULT_EVERY, 1, 3600),
        conds: normalizeConds(r.conds),
        join: r.join === 'or' ? 'or' : 'and',
        text: bool(r.text, true),
        textMessage: typeof r.textMessage === 'string' ? r.textMessage : '',
        voice: bool(r.voice, true),
        voiceMessage: typeof r.voiceMessage === 'string' ? r.voiceMessage : '',
        textKeep: intIn(r.textKeep, DEFAULT_TEXT_KEEP, 1, 600),
        loud: bool(r.loud, false),
        dismiss: {
            condFails: bool(d.condFails, false),
            ccEnds: bool(d.ccEnds, false),
            replaced: bool(d.replaced, false),
        },
    };
}

/** Saved rules; a first run, or an empty list saved before sections existed, gets the default rules. */
function normalizeRules(root: Record<string, unknown>): AlertRule[] {
    const v = root.rules;
    if (!Array.isArray(v) || (v.length === 0 && !('general' in root) && !Array.isArray(root.widgets))) return defaultRules();
    return v.map(normalizeRule).filter((r): r is AlertRule => r !== null);
}

/** A saved CC section; v1 settings carry only `cc.iconSize`, which sets the three CC sections' size. */
function normalizeSection(root: Record<string, unknown>, id: CcSectionId): CcSectionData {
    const saved = root[id];
    if (typeof saved === 'object' && saved !== null) return normalizeCcSection(saved, id);
    const legacy = rec(root.cc).iconSize;
    const s = normalizeCcSection(null, id);
    if (id !== 'burst' && id !== 'misc' && (legacy === 's' || legacy === 'm' || legacy === 'l')) s.look.size = legacy;
    return s;
}

/** Fills missing or invalid fields from the defaults, clamps opacity, dedups lists. */
export function normalizeOverlaySettings(v: unknown): OverlaySettings {
    const d = defaultOverlaySettings();
    const dps = rec(rec(v).dps);
    const al = rec(rec(v).alerts);
    const vo = rec(rec(v).voice);
    return {
        v: SETTINGS_VERSION,
        scale: num(rec(v).scale, d.scale, 80, 150),
        general: normalizeGeneral(rec(v).general),
        ccBoss: normalizeSection(rec(v), 'ccBoss'),
        ccSelf: normalizeSection(rec(v), 'ccSelf'),
        ccParty: normalizeSection(rec(v), 'ccParty'),
        burst: normalizeSection(rec(v), 'burst'),
        misc: normalizeSection(rec(v), 'misc'),
        cooldown: normalizeCooldownSection(rec(v).cooldown),
        dpsLook: normalizeDpsLook(rec(v).dpsLook, dps),
        alerts: {
            opacity: opacity(al.opacity, d.alerts.opacity),
            bg: color(al.bg, d.alerts.bg),
            fontSize: step(al.fontSize, d.alerts.fontSize),
        },
        rules: normalizeRules(rec(v)),
        voice: {
            voiceName: typeof vo.voiceName === 'string' ? vo.voiceName : d.voice.voiceName,
            rate: num(vo.rate, d.voice.rate, 0.6, 1.8),
            volume: num(vo.volume, d.voice.volume, 0, 100),
            muted: bool(vo.muted, d.voice.muted),
        },
    };
}

const KEY = 'overlay';
const isAny = (_v: unknown): _v is unknown => true;

export function loadOverlaySettings(): OverlaySettings {
    const saved = loadSetting<unknown>(KEY, null, isAny);
    const old = typeof saved !== 'object' || saved === null || (saved as { v?: unknown }).v !== SETTINGS_VERSION;
    return old ? defaultOverlaySettings() : normalizeOverlaySettings(saved);
}

export function saveOverlaySettings(s: OverlaySettings): void {
    saveSetting(KEY, s);
}

import { loadSetting, saveSetting } from './settingsStorage';
import { AWAKENING_CC_ID } from './ccConditionTooltip';

export type SizeStep = 's' | 'm' | 'l';

export interface DpsOverlaySettings {
    opacity: number;
    fontSize: SizeStep;
    columns: { dps: boolean; total: boolean; share: boolean };
    top: { boss: boolean; time: boolean; partyDps: boolean };
}

export type CcSection = 'boss' | 'self' | 'party';

export interface CcOverlaySettings {
    opacity: number;
    iconSize: SizeStep;
    sections: Record<CcSection, number[]>;
}

export interface CooldownOverlaySettings { opacity: number; iconSize: SizeStep }
export interface AlertsOverlaySettings { opacity: number; fontSize: SizeStep }

export type AlertTarget = 'boss' | 'self' | 'party' | 'all';

export type AlertKind = 'countdown' | 'periodic';
export interface AlertCond { mode: 'absent' | 'present'; ccId: number }
export interface AlertDismiss { condFails: boolean; ccEnds: boolean; replaced: boolean }

export interface AlertRule {
    id: string;
    enabled: boolean;
    kind: AlertKind;
    target: AlertTarget;
    /** Countdown: the watched CC. Periodic: unused, 0. */
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
    dismiss: AlertDismiss;
}

export interface VoiceSettings { voiceName: string; rate: number; volume: number; muted: boolean }

export interface OverlaySettings {
    v: 1;
    scale: number;
    dps: DpsOverlaySettings;
    cc: CcOverlaySettings;
    cooldown: CooldownOverlaySettings;
    alerts: AlertsOverlaySettings;
    rules: AlertRule[];
    voice: VoiceSettings;
}

export const FONT_PX: Record<SizeStep, number> = { s: 12, m: 14, l: 16 };
export const ICON_PX: Record<SizeStep, number> = { s: 24, m: 32, l: 40 };

// 覺醒, 戰場的序曲, 活潑板
export const DEFAULT_SELF_CC: number[] = [AWAKENING_CC_ID, 680, 192];
// Its own list, so changing the battle tab's defaults does not change the overlay's.
export const DEFAULT_BOSS_CC: number[] = [803, 1026, 464, 578, 10001, 10002, 1164, 1165, 1166, 1093, 392, 912, 598, 1138];

export function defaultOverlaySettings(): OverlaySettings {
    return {
        v: 1,
        scale: 100,
        dps: {
            opacity: 60,
            fontSize: 'm',
            columns: { dps: true, total: false, share: true },
            top: { boss: true, time: true, partyDps: false },
        },
        cc: {
            opacity: 0,
            iconSize: 'm',
            sections: {
                boss: [...DEFAULT_BOSS_CC],
                self: [...DEFAULT_SELF_CC],
                party: [...DEFAULT_SELF_CC],
            },
        },
        cooldown: { opacity: 60, iconSize: 'm' },
        alerts: { opacity: 60, fontSize: 'm' },
        rules: [],
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

function idList(v: unknown, fb: number[]): number[] {
    if (!Array.isArray(v)) return [...fb];
    const out: number[] = [];
    for (const x of v) {
        if (typeof x === 'number' && Number.isInteger(x) && x > 0 && !out.includes(x)) out.push(x);
    }
    return out;
}

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
    if (kind !== 'countdown' && kind !== 'periodic') return null;
    if (target !== 'boss' && target !== 'self' && target !== 'party' && target !== 'all') return null;
    let ccId = 0;
    let times: number[] = [];
    if (kind === 'countdown') {
        const id = posInt(r.ccId);
        if (id === null) return null;
        ccId = id;
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
        dismiss: {
            condFails: bool(d.condFails, false),
            ccEnds: bool(d.ccEnds, false),
            replaced: bool(d.replaced, false),
        },
    };
}

/** Fills missing or invalid fields from the defaults, clamps opacity, dedups lists. */
export function normalizeOverlaySettings(v: unknown): OverlaySettings {
    const d = defaultOverlaySettings();
    const dps = rec(rec(v).dps);
    const cc = rec(rec(v).cc);
    const cols = rec(dps.columns);
    const top = rec(dps.top);
    const sec = rec(cc.sections);
    const cd = rec(rec(v).cooldown);
    const al = rec(rec(v).alerts);
    const vo = rec(rec(v).voice);
    const rules = rec(v).rules;
    return {
        v: 1,
        scale: num(rec(v).scale, d.scale, 80, 150),
        dps: {
            opacity: opacity(dps.opacity, d.dps.opacity),
            fontSize: step(dps.fontSize, d.dps.fontSize),
            columns: {
                dps: bool(cols.dps, d.dps.columns.dps),
                total: bool(cols.total, d.dps.columns.total),
                share: bool(cols.share, d.dps.columns.share),
            },
            top: {
                boss: bool(top.boss, d.dps.top.boss),
                time: bool(top.time, d.dps.top.time),
                partyDps: bool(top.partyDps, d.dps.top.partyDps),
            },
        },
        cc: {
            opacity: opacity(cc.opacity, d.cc.opacity),
            iconSize: step(cc.iconSize, d.cc.iconSize),
            sections: {
                boss: idList(sec.boss, d.cc.sections.boss),
                self: idList(sec.self, d.cc.sections.self),
                party: idList(sec.party, d.cc.sections.party),
            },
        },
        cooldown: {
            opacity: opacity(cd.opacity, d.cooldown.opacity),
            iconSize: step(cd.iconSize, d.cooldown.iconSize),
        },
        alerts: {
            opacity: opacity(al.opacity, d.alerts.opacity),
            fontSize: step(al.fontSize, d.alerts.fontSize),
        },
        rules: Array.isArray(rules)
            ? rules.map(normalizeRule).filter((r): r is AlertRule => r !== null)
            : [],
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
    return normalizeOverlaySettings(loadSetting<unknown>(KEY, null, isAny));
}

export function saveOverlaySettings(s: OverlaySettings): void {
    saveSetting(KEY, s);
}

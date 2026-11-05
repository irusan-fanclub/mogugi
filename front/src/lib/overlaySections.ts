export type SizeChoice = 's' | 'm' | 'l' | 'c';
export const ICON_SIZE_PX: Record<'s' | 'm' | 'l', number> = { s: 28, m: 36, l: 44 };
export const DPS_FONT_PX: Record<'s' | 'm' | 'l', number> = { s: 12, m: 14, l: 17 };

export interface PanelBg { color: string; alpha: number }
export interface OverlayGeneral { bg: PanelBg; warn: string; gone: string; ok: string }

export type CcSectionId = 'ccBoss' | 'ccSelf' | 'ccParty' | 'burst' | 'misc';
export type SectionId = CcSectionId | 'cooldown';
export const CC_SECTION_IDS: readonly CcSectionId[] = ['ccBoss', 'ccSelf', 'ccParty', 'burst', 'misc'];

export type CcNames = 'label' | 'member' | 'none';
export interface IconRef { kind: 'cc' | 'skill'; id: number }
/** `title`: show the section name above the icons (section and group frames). */
export interface CcLook { size: SizeChoice; px: number; names: CcNames; dim: number; bg: PanelBg | null; title: boolean }
export interface CcItem {
    id: number; ids: number[]; enabled: boolean; label: string; icon: IconRef;
    warnSec: number; warnHl: boolean; goneHl: boolean; renew: number;
    /** 自身秘法: show the item only when MY arcana is listed. */
    arcana: number[];
    /** 隊友秘法 (ccParty): show a teammate's tile only when THEIR arcana is listed. */
    mateArcana: number[];
}
export interface CcSection { look: CcLook; items: CcItem[] }

export type CooldownWho = 'self' | 'party' | 'all';
export interface CooldownItem { skillId: number; cooldownSec: number; ccId: number; enabled: boolean; who: CooldownWho; arcana: number[] }
export interface CooldownLook { size: SizeChoice; px: number; names: boolean; bg: PanelBg | null; title: boolean }
export interface CooldownSection { look: CooldownLook; items: CooldownItem[] }

export interface DpsLook {
    font: SizeChoice; fpx: number; bg: PanelBg | null;
    columns: { dps: boolean; total: boolean; share: boolean };
    top: { boss: boolean; hpPct: boolean; hpLeft: boolean; time: boolean; partyDps: boolean };
}

export const MUSIC_CC: readonly number[] = [680, 192, 193];
export const TUAN_CC = 1124;

const DEFAULT_PANEL = '#0e1013';
const LABEL_MAX = 6;
const ARCANA_MAX = 10;

export const iconPx = (look: { size: SizeChoice; px: number }): number =>
    look.size === 'c' ? look.px : ICON_SIZE_PX[look.size];
export const dpsFontPx = (look: DpsLook): number => look.font === 'c' ? look.fpx : DPS_FONT_PX[look.font];

export const defaultGeneral = (): OverlayGeneral => ({
    bg: { color: DEFAULT_PANEL, alpha: 0 }, warn: '#e8a33d', gone: '#e5534b', ok: '#5cc26a',
});

export function defaultDpsLook(): DpsLook {
    return {
        font: 'm', fpx: 14, bg: { color: DEFAULT_PANEL, alpha: 25 },
        columns: { dps: true, total: false, share: true },
        top: { boss: true, hpPct: true, hpLeft: false, time: true, partyDps: true },
    };
}

export function defaultCcItem(section: CcSectionId, id: number, label: string): CcItem {
    const preset = defaultCcSection(section).items.find(i => i.id === id);
    if (preset) return preset;
    return {
        id, ids: [id], enabled: true, label, icon: { kind: 'cc', id },
        warnSec: 30, warnHl: true, goneHl: true, renew: 0, arcana: [], mateArcana: [],
    };
}

export const defaultCooldownItem = (skillId: number): CooldownItem =>
    ({ skillId, cooldownSec: 60, ccId: 0, enabled: true, who: 'party', arcana: [] });

const cc = (id: number, label: string, o: Partial<CcItem> = {}): CcItem => ({
    id, ids: [id], enabled: true, label, icon: { kind: 'cc', id },
    warnSec: 30, warnHl: true, goneHl: true, renew: 0, arcana: [], mateArcana: [], ...o,
});

export function defaultCcSection(id: CcSectionId): CcSection {
    const look: CcLook = { size: 'm', px: 36, names: 'label', dim: 40, bg: null, title: false };
    switch (id) {
        case 'ccBoss':
            return { look, items: [
                cc(1164, '減物保'), cc(1165, '減魔保'), cc(1166, '增傷'),
                cc(323, '憤衝', { icon: { kind: 'skill', id: 20018 }, arcana: [1] }),
            ] };
        case 'ccSelf':
            return { look: { ...look, title: true }, items: [
                cc(680, '戰場', { renew: TUAN_CC }), cc(192, '活潑', { renew: TUAN_CC, arcana: [2, 3, 8] }),
                cc(193, '進行', { renew: TUAN_CC }),
                cc(476, '銳貫', { ids: [476, 511], icon: { kind: 'cc', id: 511 }, warnSec: 15 }),
                cc(63, '攻水', { arcana: [1, 4, 5, 6, 7, 9, 10] }),
                cc(1121, '魔法攻擊力強', { arcana: [3] }), cc(1150, '鍊金術傷害增', { arcana: [8] }),
                cc(1225, '倉鼠'),
            ] };
        case 'ccParty':
            return { look: { ...look, names: 'member' }, items: [
                cc(680, '戰場', { renew: TUAN_CC, mateArcana: [1, 4, 5, 6, 9, 10] }),
                cc(192, '活潑', { renew: TUAN_CC, mateArcana: [2, 3, 8] }),
                cc(193, '進行'),
                cc(63, '攻水', { mateArcana: [1, 4, 5, 6, 7, 8, 9, 10] }),
                cc(1121, '攻水', { mateArcana: [3] }), cc(1150, '攻水', { mateArcana: [8] }),
                cc(476, '銳貫', { ids: [476, 511], icon: { kind: 'cc', id: 511 }, mateArcana: [1, 3, 4, 5, 6, 7, 8, 9, 10] }),
                cc(1120, '自然力', { mateArcana: [1] }), cc(1122, '槍眼', { mateArcana: [7], warnSec: 10 }),
                cc(1225, '倉鼠', { mateArcana: [1, 3, 4, 5, 6, 7, 8, 9, 10] }),
            ] };
        case 'misc':
            return { look: { ...look, size: 'l' }, items: [cc(428, '信念', { icon: { kind: 'cc', id: 21 }, warnHl: false, goneHl: false })] };
        case 'burst':
            return { look: { size: 'c', px: 52, names: 'label', dim: 100, bg: null, title: false }, items: [
                cc(516, '覺醒', { warnHl: false, goneHl: false }), cc(900206, '戰吼', { warnHl: false, goneHl: false }),
            ] };
    }
}

export function defaultCooldownSection(): CooldownSection {
    const it = (skillId: number, cooldownSec: number, ccId: number): CooldownItem =>
        ({ ...defaultCooldownItem(skillId), cooldownSec, ccId });
    return {
        look: { size: 'm', px: 36, names: true, bg: null, title: false },
        items: [it(59005, 180, 803), it(59143, 60, 0), it(59123, 30, 0)],
    };
}

export const itemKey = (item: CcItem | CooldownItem): string => String('id' in item ? item.id : item.skillId);
export const unitId = (section: SectionId, key: string): string => `${section}-${key}`;

/** Section order: keys in `order` that exist, then the rest in settings order. */
export function orderedKeys(keys: string[], order: string[] | undefined): string[] {
    const out: string[] = [];
    for (const k of order ?? []) if (keys.includes(k) && !out.includes(k)) out.push(k);
    for (const k of keys) if (!out.includes(k)) out.push(k);
    return out;
}

const rec = (v: unknown): Record<string, unknown> =>
    typeof v === 'object' && v !== null ? v as Record<string, unknown> : {};
const bool = (v: unknown, fb: boolean): boolean => typeof v === 'boolean' ? v : fb;
const color = (v: unknown, fb: string): string =>
    typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fb;
function int(v: unknown, fb: number, lo: number, hi: number): number {
    if (typeof v !== 'number' || !Number.isFinite(v)) return fb;
    return Math.min(hi, Math.max(lo, Math.round(v)));
}
const posInt = (v: unknown): number | null =>
    typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
const size = (v: unknown, fb: SizeChoice): SizeChoice =>
    v === 's' || v === 'm' || v === 'l' || v === 'c' ? v : fb;

function bg(v: unknown, fb: PanelBg | null): PanelBg | null {
    if (typeof v !== 'object' || v === null) return fb;
    const r = rec(v);
    return { color: color(r.color, DEFAULT_PANEL), alpha: int(r.alpha, 35, 0, 100) };
}

function idArray(v: unknown, max = Infinity): number[] {
    const out: number[] = [];
    if (Array.isArray(v)) for (const x of v) {
        const n = posInt(x);
        if (n !== null && n <= max && !out.includes(n)) out.push(n);
    }
    return out;
}

function normalizeCcItem(v: unknown, section: CcSectionId): CcItem | null {
    const r = rec(v);
    const id = posInt(r.id);
    if (id === null) return null;
    const d = defaultCcItem(section, id, '');
    const ic = rec(r.icon);
    const iconId = posInt(ic.id);
    const label = typeof r.label === 'string' ? Array.from(r.label).slice(0, LABEL_MAX).join('') : d.label;
    return {
        id,
        ids: [id, ...idArray(r.ids).filter(x => x !== id)],
        enabled: bool(r.enabled, true),
        label,
        icon: (ic.kind === 'cc' || ic.kind === 'skill') && iconId !== null ? { kind: ic.kind, id: iconId } : d.icon,
        warnSec: int(r.warnSec, d.warnSec, 1, 600),
        warnHl: bool(r.warnHl, d.warnHl),
        goneHl: bool(r.goneHl, d.goneHl),
        renew: posInt(r.renew) ?? 0,
        arcana: idArray(r.arcana, ARCANA_MAX),
        mateArcana: idArray(r.mateArcana, ARCANA_MAX),
    };
}

export function normalizeCcSection(v: unknown, id: CcSectionId): CcSection {
    const d = defaultCcSection(id);
    const r = rec(v);
    const l = rec(r.look);
    const items: CcItem[] = [];
    if (Array.isArray(r.items)) {
        for (const x of r.items) {
            const it = normalizeCcItem(x, id);
            if (it && !items.some(o => o.id === it.id)) items.push(it);
        }
    }
    return {
        look: {
            size: size(l.size, d.look.size),
            px: int(l.px, d.look.px, 16, 96),
            names: l.names === 'label' || l.names === 'member' || l.names === 'none' ? l.names : d.look.names,
            dim: int(l.dim, d.look.dim, 10, 100),
            bg: bg(l.bg, null),
            title: bool(l.title, d.look.title),
        },
        items: Array.isArray(r.items) ? items : d.items,
    };
}

function normalizeCooldownItem(v: unknown): CooldownItem | null {
    const r = rec(v);
    const skillId = posInt(r.skillId);
    if (skillId === null) return null;
    return {
        skillId,
        cooldownSec: int(r.cooldownSec, 60, 1, 3600),
        ccId: posInt(r.ccId) ?? 0,
        enabled: bool(r.enabled, true),
        who: r.who === 'self' || r.who === 'party' || r.who === 'all' ? r.who : 'party',
        arcana: idArray(r.arcana, ARCANA_MAX),
    };
}

export function normalizeCooldownSection(v: unknown): CooldownSection {
    const d = defaultCooldownSection();
    const r = rec(v);
    const l = rec(r.look);
    const items: CooldownItem[] = [];
    if (Array.isArray(r.items)) {
        for (const x of r.items) {
            const it = normalizeCooldownItem(x);
            if (it && !items.some(o => o.skillId === it.skillId)) items.push(it);
        }
    }
    return {
        look: {
            size: size(l.size, d.look.size),
            px: int(l.px, d.look.px, 16, 96),
            names: bool(l.names, d.look.names),
            bg: bg(l.bg, null),
            title: bool(l.title, false),
        },
        items: Array.isArray(r.items) ? items : d.items,
    };
}

export function normalizeGeneral(v: unknown): OverlayGeneral {
    const d = defaultGeneral();
    const r = rec(v);
    return {
        bg: bg(r.bg, d.bg) as PanelBg,
        warn: color(r.warn, d.warn),
        gone: color(r.gone, d.gone),
        ok: color(r.ok, d.ok),
    };
}

/** `v`: the saved look. `legacy`: the v0.6.0 `dps` object, used only when there is no saved look. */
export function normalizeDpsLook(v: unknown, legacy?: Record<string, unknown>): DpsLook {
    const d = defaultDpsLook();
    const has = typeof v === 'object' && v !== null;
    const src = has ? rec(v) : {};
    const lg = has ? {} : rec(legacy);
    const cols = rec(has ? src.columns : lg.columns);
    const top = rec(has ? src.top : lg.top);
    const font = has ? src.font : lg.fontSize;
    // A saved null bg means "follow the general background"; a missing one takes the default.
    let look: PanelBg | null = d.bg;
    if (has) look = 'bg' in src ? bg(src.bg, null) : d.bg;
    else if (typeof lg.opacity === 'number') look = { color: color(lg.bg, DEFAULT_PANEL), alpha: int(lg.opacity, 35, 0, 100) };
    return {
        font: size(font, d.font),
        fpx: int(src.fpx, d.fpx, 10, 40),
        bg: look,
        columns: {
            dps: bool(cols.dps, d.columns.dps),
            total: bool(cols.total, d.columns.total),
            share: bool(cols.share, d.columns.share),
        },
        top: {
            boss: bool(top.boss, d.top.boss),
            hpPct: bool(top.hpPct, d.top.hpPct),
            hpLeft: bool(top.hpLeft, d.top.hpLeft),
            time: bool(top.time, d.top.time),
            partyDps: bool(top.partyDps, d.top.partyDps),
        },
    };
}

// Decides what an imported share changes: new settings plus layout saves/removes.
import { layoutOf, SECTION_ORDER } from './overlayComponents';
import type { Anchor, OverlayLayout } from './overlayProtocol';
import type { OverlaySettings } from './overlaySettings';
import type { SharePayload } from './overlayShareCodec';

export type RegionId = 'general' | 'dps' | 'ccBoss' | 'ccSelf' | 'ccParty' | 'cooldown' | 'misc' | 'burst' | 'alerts';

// Same labels and order as the OverlayTab PAGES list.
export const REGIONS: readonly { id: RegionId; label: string; hasPosition: boolean }[] = [
    { id: 'general', label: '通用', hasPosition: false },
    { id: 'dps', label: '簡易戰鬥資訊', hasPosition: true },
    { id: 'ccBoss', label: 'BOSS CC', hasPosition: true },
    { id: 'ccSelf', label: '自己 CC', hasPosition: true },
    { id: 'ccParty', label: '隊伍 CC', hasPosition: true },
    { id: 'cooldown', label: '技能冷卻', hasPosition: true },
    { id: 'misc', label: '雜項', hasPosition: true },
    { id: 'burst', label: '爆發提示（開發中）', hasPosition: true },
    { id: 'alerts', label: '提醒（開發中）', hasPosition: true },
];

export type Layouts = Partial<Record<string, OverlayLayout>>;
export interface RegionPick { import: boolean; position: boolean }
export interface LayoutOps { saves: Record<string, OverlayLayout>; removes: string[] }
export interface MergeResult extends LayoutOps { settings: OverlaySettings }

const ID_RE = /^[A-Za-z0-9_-]+$/;
const ANCHORS: readonly string[] = ['tl', 'tr', 'bl', 'br', 'center'];
const FIXED_IDS = ['dps', 'alerts', ...SECTION_ORDER];
const MAX_ORDER = 64;
/** Go's maxOverlayFrame; the limit is in UTF-8 bytes. */
export const MAX_FRAME_LEN = 2048;
const BLOCKED_IDS = ['__proto__', 'constructor', 'prototype'];

const isPlain = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);
const validId = (v: unknown): v is string => typeof v === 'string' && ID_RE.test(v);
const inRange = (v: unknown, lo: number, hi: number): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

export function regionOfLayoutId(id: string): RegionId | null {
    if (id === 'dps' || id === 'alerts') return id;
    for (const sec of SECTION_ORDER) {
        if (id === sec) return sec;
        if (id.startsWith(sec + '-') && ID_RE.test(id.slice(sec.length + 1))) return sec;
    }
    return null;
}

/** Keeps only layouts Go's ValidOverlayLayout accepts; repairs order and dock instead of dropping. */
export function sanitizeLayouts(raw: Record<string, unknown>): Layouts {
    const out: Layouts = {};
    for (const [id, v] of Object.entries(raw)) {
        if (!validId(id) || BLOCKED_IDS.includes(id) || !isPlain(v)) continue;
        if (typeof v.enabled !== 'boolean' || typeof v.anchor !== 'string' || !ANCHORS.includes(v.anchor)) continue;
        if (!inRange(v.x, -1e6, 1e6) || !inRange(v.y, -1e6, 1e6)) continue;
        if (!inRange(v.width, 120, 800) || !inRange(v.maxRows, 1, 20)) continue;
        const l: OverlayLayout = { enabled: v.enabled, anchor: v.anchor as Anchor, x: v.x, y: v.y, width: v.width, maxRows: v.maxRows };
        if ('dock' in v) l.dock = validId(v.dock) ? v.dock : '';
        if (Array.isArray(v.order)) l.order = v.order.filter(validId).slice(0, MAX_ORDER);
        if (typeof v.frame === 'string' && new TextEncoder().encode(v.frame).length <= MAX_FRAME_LEN) l.frame = v.frame;
        out[id] = l;
    }
    return out;
}

export function regionSummary(p: SharePayload, r: RegionId): string {
    const s = p.settings;
    switch (r) {
        case 'general': return '背景、狀態顏色、整體縮放';
        case 'dps': return '';
        case 'cooldown': return `${s.cooldown.items.length} 個技能`;
        case 'alerts': return `${s.rules.length} 條規則、提醒框外觀、語音`;
        default: return `${s[r].items.length} 個圖示`;
    }
}

/** Compares layouts treating a missing dock/order/frame as empty. */
const canon = (l: OverlayLayout) => JSON.stringify([l.enabled, l.anchor, l.x, l.y, l.width, l.maxRows, l.dock ?? '', l.order ?? [], l.frame ?? '']);
const sameLayout = (a: OverlayLayout | undefined, b: OverlayLayout | undefined) =>
    !!a && !!b && canon(a) === canon(b);

function applySettings(next: OverlaySettings, own: OverlaySettings, from: OverlaySettings, r: RegionId) {
    const c = <T>(v: T): T => structuredClone(v);
    switch (r) {
        case 'general': next.general = c(from.general); next.scale = from.scale; break;
        case 'dps': next.dpsLook = c(from.dpsLook); break;
        case 'alerts':
            next.alerts = c(from.alerts);
            next.rules = c(from.rules);
            next.voice = { ...c(from.voice), voiceName: own.voice.voiceName };
            break;
        case 'cooldown': next.cooldown = c(from.cooldown); break;
        default: next[r] = c(from[r]);
    }
}

function repairDocks(layouts: Layouts) {
    const existing = new Set([...FIXED_IDS, ...Object.keys(layouts)]);
    const undock = (id: string) => {
        layouts[id] = { ...layouts[id]!, dock: '', anchor: 'center', x: 0, y: 0 };
    };
    for (const id of Object.keys(layouts)) {
        const d = layouts[id]!.dock;
        if (d && !existing.has(d)) undock(id);
    }
    for (;;) {
        const cycle = findCycle(layouts);
        if (!cycle) return;
        undock(cycle.sort()[0]);
    }
}

function findCycle(layouts: Layouts): string[] | null {
    for (const start of Object.keys(layouts).sort()) {
        const path: string[] = [];
        let cur: string | undefined = start;
        while (cur && layouts[cur]) {
            const at = path.indexOf(cur);
            if (at >= 0) return path.slice(at);
            path.push(cur);
            cur = layouts[cur]!.dock || undefined;
        }
    }
    return null;
}

export function mergeImport(
    own: OverlaySettings, ownLayouts: Layouts, p: SharePayload, picks: Partial<Record<RegionId, RegionPick>>,
): MergeResult {
    const sent = sanitizeLayouts(p.layouts);
    const settings = structuredClone(own);
    const target: Layouts = {};
    for (const [id, l] of Object.entries(ownLayouts)) if (l) target[id] = l;

    for (const r of REGIONS) {
        const pick = picks[r.id];
        if (!pick?.import) continue;
        applySettings(settings, own, p.settings, r.id);
        if (r.id === 'general') continue;
        const theirs = layoutOf(r.id, sent);
        if (pick.position) {
            for (const id of Object.keys(target)) {
                if (regionOfLayoutId(id) === r.id || (r.id === 'ccBoss' && id === 'cc')) delete target[id];
            }
            for (const [id, l] of Object.entries(sent)) if (l && regionOfLayoutId(id) === r.id) target[id] = l;
            // An unstored sender frame stays unstored (same effective default), unless a legacy cc supplies it.
            if (sent[r.id] || (r.id === 'ccBoss' && sent.cc)) target[r.id] = theirs;
        } else {
            const main: OverlayLayout = { ...layoutOf(r.id, ownLayouts), enabled: theirs.enabled };
            delete main.order;
            if (theirs.order) main.order = theirs.order;
            target[r.id] = main;
        }
    }
    repairDocks(target);

    const ops = diffLayouts(ownLayouts, target);
    return { settings, ...ops };
}

/** Ops that turn `from` into `to`. */
function diffLayouts(from: Layouts, to: Layouts): LayoutOps {
    const saves: Record<string, OverlayLayout> = {};
    const removes: string[] = [];
    for (const id of Object.keys(from)) if (from[id] && !to[id]) removes.push(id);
    for (const [id, l] of Object.entries(to)) if (l && !sameLayout(from[id], l)) saves[id] = l;
    return { saves, removes };
}

export const undoOps = (before: Layouts, after: Layouts): LayoutOps => diffLayouts(after, before);

export function applyOps(layouts: Layouts, ops: LayoutOps): Layouts {
    const out: Layouts = { ...layouts };
    for (const id of ops.removes) delete out[id];
    for (const [id, l] of Object.entries(ops.saves)) out[id] = l;
    return out;
}

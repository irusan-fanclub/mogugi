// Per-frame record (name, title switch, optional own look) stored as JSON in OverlayLayout.frame.
import { COMPONENT_NAMES, sectionItems } from './overlayComponents';
import { groupIdsOf, isGroupOf, type Layouts } from './overlayGroups';
import type { ComponentId, OverlayLayout } from './overlayProtocol';
import type { OverlaySettings } from './overlaySettings';
import {
    cleanTitleText, defaultCcSection, defaultCooldownSection, itemKey, normalizeCcLook, normalizeCooldownLook, unitId,
    type CcLook, type CooldownLook, type SectionId,
} from './overlaySections';

export type SectionLook = CcLook | CooldownLook;
/** `titleOn` null follows the section's `title`; `look` null follows the section look. */
export interface FrameRec { n: number; name: string; titleOn: boolean | null; look: SectionLook | null }

export const frameField = (r: FrameRec): string => JSON.stringify(r);

const defaultName = (sec: SectionId, n: number): string => `${COMPONENT_NAMES[sec]} ${n}`;

export function defaultFrameRec(sec: SectionId, kind: 'unit' | 'group', n: number): FrameRec {
    return { n, name: defaultName(sec, n), titleOn: kind === 'unit' ? false : null, look: null };
}

export const resetFrameRec = (sec: SectionId, kind: 'unit' | 'group', r: FrameRec): FrameRec =>
    defaultFrameRec(sec, kind, r.n);

export function parseFrame(sec: SectionId, raw: string | undefined): FrameRec | null {
    if (!raw) return null;
    let v: unknown;
    try { v = JSON.parse(raw); } catch { return null; }
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
    const r = v as Record<string, unknown>;
    if (typeof r.n !== 'number' || !Number.isInteger(r.n) || r.n <= 0) return null;
    let look: SectionLook | null = null;
    if (typeof r.look === 'object' && r.look !== null) {
        look = sec === 'cooldown'
            ? normalizeCooldownLook(r.look, defaultCooldownSection().look)
            : normalizeCcLook(r.look, defaultCcSection(sec).look);
    }
    return {
        n: r.n,
        name: cleanTitleText(r.name) || defaultName(sec, r.n),
        titleOn: typeof r.titleOn === 'boolean' ? r.titleOn : null,
        look,
    };
}

const SECTIONS: readonly SectionId[] = ['ccBoss', 'ccSelf', 'ccParty', 'cooldown', 'burst', 'misc'];

/** Fresh records for every unit/group layout that has none; numbers are handed out per section. */
export function missingFrameRecords(s: OverlaySettings, layouts: Layouts): Record<ComponentId, OverlayLayout> {
    const out: Record<ComponentId, OverlayLayout> = {};
    for (const sec of SECTIONS) {
        const groups = groupIdsOf(sec, layouts).map(id => ({ id, kind: 'group' as const }));
        const units = sectionItems(s, sec).map(it => unitId(sec, itemKey(it)))
            .filter(id => layouts?.[id] && !isGroupOf(sec, id)).map(id => ({ id, kind: 'unit' as const }));
        const used = new Set<number>();
        const todo: { id: ComponentId; kind: 'unit' | 'group' }[] = [];
        for (const e of [...groups, ...units]) {
            const rec = parseFrame(sec, layouts?.[e.id]?.frame);
            if (rec) used.add(rec.n); else todo.push(e);
        }
        let n = 1;
        for (const e of todo) {
            while (used.has(n)) n++;
            used.add(n);
            const lay = layouts?.[e.id];
            if (lay) out[e.id] = { ...lay, frame: frameField(defaultFrameRec(sec, e.kind, n)) };
        }
    }
    return out;
}

export const sectionTitle = (s: OverlaySettings, sec: SectionId): string =>
    (sec === 'cooldown' ? s.cooldown.look : s[sec].look).titleText || COMPONENT_NAMES[sec];

export function memberClassOf(sec: SectionId, key: string): string {
    if (sec === 'cooldown') return key;
    if (key === '192') return '680';
    if (key === '1121' || key === '1150') return '63';
    return key;
}

// What the overlay page draws for a section or unit frame, kept out of OverlayApp.vue.
import type { ComponentDef, ItemNamer } from '@/lib/overlayComponents';
import { sectionItems } from '@/lib/overlayComponents';
import { FONT_PX, type OverlaySettings } from '@/lib/overlaySettings';
import {
    dpsFontPx, iconPx, itemKey, orderedKeys, type CcSection, type CooldownSection, type PanelBg, type SectionId,
} from '@/lib/overlaySections';
import type { Layouts } from '@/lib/overlayGroups';
import { parseFrame, sectionTitle, type SectionLook } from '@/lib/overlayFrames';
import type { TileVM } from '@/lib/overlayTiles';
import { ccName } from '@/lib/util';
import { condNameMap, skillNameMap } from '@/store';

export const rgba = (hex: string, alpha: number) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${alpha / 100})`;
};
const panel = (b: PanelBg) => rgba(b.color, b.alpha);

export const sectionOf = (s: OverlaySettings, sec: SectionId): CcSection | CooldownSection =>
    sec === 'cooldown' ? s.cooldown : s[sec];

/** A pulled frame with its own look uses it; every other frame follows the section look. */
export function frameLook(s: OverlaySettings, c: ComponentDef, layouts: Layouts): SectionLook {
    const own = c.kind === 'unit' || c.kind === 'group' ? parseFrame(c.section!, layouts?.[c.id]?.frame)?.look : null;
    return own ?? sectionOf(s, c.section!).look;
}

/** The title over a frame; '' when it shows none. */
export function frameTitle(s: OverlaySettings, c: ComponentDef, layouts: Layouts): string {
    if (c.kind !== 'section' && c.kind !== 'unit' && c.kind !== 'group') return '';
    const on = sectionOf(s, c.section!).look.title;
    if (c.kind === 'section') return on ? sectionTitle(s, c.section!) : '';
    const rec = parseFrame(c.section!, layouts?.[c.id]?.frame);
    if (!rec) return c.kind === 'group' && on ? sectionTitle(s, c.section!) : '';
    return (rec.titleOn ?? on) ? rec.name : '';
}

/** Frame background: the frame's own look, else the general panel colour. */
export function bgOf(s: OverlaySettings, c: ComponentDef, layouts: Layouts): string {
    if (c.kind === 'alerts') return rgba(s.alerts.bg, s.alerts.opacity);
    if (c.kind === 'dps') return panel(s.dpsLook.bg ?? s.general.bg);
    return panel(frameLook(s, c, layouts).bg ?? s.general.bg);
}

/** The text under a tile; by-member rows already carry the member name at the left. */
export function labelOf(t: TileVM, look: SectionLook, byMember: boolean): string {
    if (t.fixedLabel) return t.label;
    const names = look.names;
    if (names === 'label') return t.itemLabel;
    if (names === 'member' || names === true) return byMember ? '' : t.holderName;
    return '';
}

export function fontPxOf(s: OverlaySettings, c: ComponentDef): number {
    if (c.kind === 'dps') return dpsFontPx(s.dpsLook);
    if (c.kind === 'alerts') return FONT_PX[s.alerts.fontSize];
    return 14;
}

export function tileLook(s: OverlaySettings, c: ComponentDef, layouts: Layouts): { px: number; dim: number } {
    const look = frameLook(s, c, layouts);
    return { px: iconPx(look), dim: 'dim' in look ? look.dim : 100 };
}

/** Every key of the section in display order, disabled and detached ones included. */
export const sectionOrder = (s: OverlaySettings, sec: SectionId, order: string[] | undefined): string[] =>
    orderedKeys(sectionItems(s, sec).map(itemKey), order);

export const itemEnabled = (s: OverlaySettings, sec: SectionId, key: string): boolean =>
    sectionItems(s, sec).some(i => itemKey(i) === key && i.enabled);

/** Unit title part: the client's CC or skill name, else the item label or id. */
export const itemName: ItemNamer = (_sec, key, item) => {
    if ('skillId' in item) return skillNameMap.value[item.skillId] ?? key;
    if (condNameMap.value[item.id]) return ccName(condNameMap.value, item.id);
    return item.label || key;
};

/** Live frames: dps and BOSS CC need a living boss; the dungeon sections need a dungeon. */
export function gateOpen(sec: SectionId, o: { bossAlive: boolean; inDungeon: boolean }): boolean {
    if (sec === 'ccBoss') return o.bossAlive;
    if (sec === 'burst' || sec === 'misc') return true;
    return o.inDungeon;
}

/** Tiles of `keys` in that order, taken from a section's tile map. */
export const tilesFor = (map: Map<string, TileVM[]> | undefined, keys: readonly string[]): TileVM[] =>
    keys.flatMap(k => map?.get(k) ?? []);

/** Sorts sample tiles into `keys` order. */
export const inOrder = (tiles: TileVM[], keys: readonly string[]): TileVM[] =>
    [...tiles].sort((a, b) => keys.indexOf(a.key) - keys.indexOf(b.key));

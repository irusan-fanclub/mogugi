// What the overlay page draws for a section or unit frame, kept out of OverlayApp.vue.
import type { ComponentDef, ItemNamer } from '@/lib/overlayComponents';
import { sectionItems } from '@/lib/overlayComponents';
import { FONT_PX, type OverlaySettings } from '@/lib/overlaySettings';
import {
    dpsFontPx, iconPx, itemKey, orderedKeys, type CcSection, type CooldownSection, type PanelBg, type SectionId,
} from '@/lib/overlaySections';
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

/** Frame background: the section's own look, else the general panel colour. */
export function bgOf(s: OverlaySettings, c: ComponentDef): string {
    if (c.kind === 'alerts') return rgba(s.alerts.bg, s.alerts.opacity);
    if (c.kind === 'dps') return panel(s.dpsLook.bg ?? s.general.bg);
    return panel(sectionOf(s, c.section!).look.bg ?? s.general.bg);
}

export function fontPxOf(s: OverlaySettings, c: ComponentDef): number {
    if (c.kind === 'dps') return dpsFontPx(s.dpsLook);
    if (c.kind === 'alerts') return FONT_PX[s.alerts.fontSize];
    return 14;
}

export function tileLook(s: OverlaySettings, sec: SectionId): { px: number; dim: number } {
    const look = sectionOf(s, sec).look;
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

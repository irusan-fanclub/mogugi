// charSimul.ts — builds character-simulator style JSON and share links.
import type { EntityItem } from '@/eventActor';
import { COLOR_KEYS, colorCode } from './charSlots';

export interface SimulActor {
    raceId: number;
    body: {
        Height: number; Weight: number; Upper: number; Lower: number;
        SkinColor?: number; EyeType?: number; EyeColor?: number;
        LeftEyeColor?: number; RightEyeColor?: number; MouthType?: number;
    };
    equipItemMap: Record<number, EntityItem>;
}

export interface SimulSlot { Id: number; Colors: string[] }
export type SimulStyle = Record<string, number | SimulSlot>;

// Simulator slot -> pockets, costume first (the game renders the costume).
const SLOT_POCKETS: [string, number[]][] = [
    ['Armor', [43, 5]], ['Head', [46, 8]], ['Glove', [44, 6]], ['Shoes', [45, 7]], ['Robe', [47, 9]],
    ['FaceDeco', [48]], ['Tail', [90]], ['RightHand', [10]], ['LeftHand', [12]],
];

const clamp = (n: number) => Math.min(1.5, Math.max(0.5, n));

function slotOf(it: EntityItem): SimulSlot {
    const rec = it as unknown as Record<string, string | undefined>;
    const Colors = COLOR_KEYS.map(k => rec[k]).filter((c): c is string => !!c).map(colorCode);
    return { Id: it.ItemId, Colors };
}

/** Fields that are not known (old records) are omitted so the site uses its defaults. */
export function buildStyle(actor: SimulActor): SimulStyle {
    const s: SimulStyle = { Race: actor.raceId };
    const eq = actor.equipItemMap;
    const find = (pocket: number) => Object.values(eq).find(i => i.PocketType === pocket);
    const b = actor.body;

    const face = find(3);
    const hair = find(4);
    if (face) s.Face = face.ItemId;
    if (hair) {
        s.Hair = hair.ItemId;
        // The top nibble of Color1 is a flag, not part of the colour id.
        const c1 = parseInt(hair.Color1.replace(/^#/, ''), 16);
        if (Number.isFinite(c1)) s.HairColor = (c1 & 0x0fffffff) >>> 0;
    }
    if (b.SkinColor) s.SkinColor = b.SkinColor;
    if (b.EyeType) s.EyeType = b.EyeType;
    const left = b.LeftEyeColor || b.EyeColor;
    const right = b.RightEyeColor || b.EyeColor;
    if (left) s.LeftEyeColor = left;
    if (right) s.RightEyeColor = right;
    if (b.MouthType) s.MouthType = b.MouthType;
    for (const k of ['Height', 'Weight', 'Upper', 'Lower'] as const) {
        if (Number.isFinite(b[k])) s[k] = clamp(b[k]);
    }
    for (const [slot, pockets] of SLOT_POCKETS) {
        const it = pockets.map(find).find(Boolean);
        // Empty, not omitted: the sites would otherwise dress the slot with their default item.
        s[slot] = it ? slotOf(it) : { Id: 0, Colors: [] };
    }
    return s;
}

/** base64url of the UTF-8 JSON, no padding. */
export function encodeB64Url(obj: unknown): string {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export const prilusUrl = (style: SimulStyle): string =>
    `https://prilus.gitlab.io/charsimul#style=${encodeB64Url(style)}`;

export const noginogiUrl = (name: string, style: SimulStyle): string =>
    `https://gear.noginogi.sbs/character.html?look=${encodeB64Url({ name, style })}`;

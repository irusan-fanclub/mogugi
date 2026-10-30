// equipBoard.ts — equipment board layout (pockets, weapon sets) and per-slot entries, shared by both UIs.
import type { IndexItem } from './itemIndex';
import { buildTip, displayName, type Tip, type TooltipDeps } from './itemTooltip';
import { EQUIP_SLOTS, type SlotEntry } from './equipStats';
import { asHolder } from './tooltipDeps';

export type WeaponArea = 'wl' | 'wr';
// Index 0 = set I, 1 = set II.
export const WEAPON_POCKETS: Record<WeaponArea, [number, number]> = { wl: [10, 11], wr: [12, 13] };
export const MAIN_AREAS: { area: string; pocket?: number; tall?: boolean }[] = [
    { area: 'accl', pocket: 16 }, { area: 'head', pocket: 8 }, { area: 'accr', pocket: 17 },
    { area: 'wl', tall: true }, { area: 'body', pocket: 5, tall: true }, { area: 'wr', tall: true },
    { area: 'hand', pocket: 6 }, { area: 'foot', pocket: 7 }, { area: 'robe', pocket: 9 },
];
export const LEFT_POCKETS = [32, 33, 34, 35, 54];
export const RIGHT_POCKETS = [51, 62, 63, 64];

// Accessories (16/17) share group 'armor' with real armour slots, so tell them apart by pocket.
const ACCESSORY_POCKETS = new Set([16, 17]);

// Prefix then suffix enchant names, '' when the item has none.
function enchantBrief(it: IndexItem, enchantNameMap: Record<number, string>): string {
    const label = (id?: number) => id ? (enchantNameMap[id] ?? `${id}`) : undefined;
    return [label(it.enchantPrefix), label(it.enchantSuffix)].filter((s): s is string => !!s).join(' / ');
}

export function brief(it: IndexItem, pocket: number, enchantNameMap: Record<number, string>): string {
    const slot = EQUIP_SLOTS.find(s => s.pocket === pocket);
    if (slot?.group === 'weapon') {
        return `攻擊 ${it.attackMin ?? 0}~${it.attackMax ?? 0} 平衡 ${it.balance ?? 0} 暴擊 ${it.critical ?? 0}`;
    }
    if (ACCESSORY_POCKETS.has(pocket) || slot?.group === 'other') return enchantBrief(it, enchantNameMap);
    if (slot?.group === 'armor') return `防禦 ${it.defense ?? 0} 保護 ${it.protection ?? 0}`;
    return '';
}

export type EquipmentList = { pocket: number; item: IndexItem }[];

export function entryByPocket(equipment: EquipmentList, deps: TooltipDeps): Map<number, SlotEntry> {
    const m = new Map<number, SlotEntry>();
    for (const e of equipment) {
        const h = asHolder(e.item);
        m.set(e.pocket, {
            item: e.item, name: displayName(h, deps),
            brief: brief(e.item, e.pocket, deps.enchantNameMap), tip: buildTip(h, deps),
        });
    }
    return m;
}

export const slotLabel = (pocket: number): string => EQUIP_SLOTS.find(s => s.pocket === pocket)?.label ?? `#${pocket}`;

export interface BoardCell {
    region: 'left' | 'main' | 'right';
    area?: string;        // CSS grid area (main region only)
    pocket: number;
    label: string;
    tall: boolean;
    weapon?: WeaponArea;  // set on the two weapon cells
    set?: 0 | 1;          // weapon cells: which set is shown
    entry?: SlotEntry;
    empty: boolean;
}

// Left column, main 3x3 grid, right column, in that order.
export function buildBoard(
    equipment: EquipmentList, weaponSet: { wl: 0 | 1; wr: 0 | 1 }, deps: TooltipDeps,
    entries: Map<number, SlotEntry> = entryByPocket(equipment, deps),
): BoardCell[] {
    const cell = (region: BoardCell['region'], pocket: number, extra: Partial<BoardCell> = {}): BoardCell => {
        const entry = entries.get(pocket);
        return { region, pocket, label: slotLabel(pocket), tall: false, entry, empty: !entry, ...extra };
    };
    const out: BoardCell[] = LEFT_POCKETS.map(p => cell('left', p));
    for (const a of MAIN_AREAS) {
        if (a.area === 'wl' || a.area === 'wr') {
            const set = weaponSet[a.area];
            out.push(cell('main', WEAPON_POCKETS[a.area][set], { area: a.area, tall: !!a.tall, weapon: a.area, set }));
        } else {
            out.push(cell('main', a.pocket!, { area: a.area, tall: !!a.tall }));
        }
    }
    for (const p of RIGHT_POCKETS) out.push(cell('right', p));
    return out;
}

// Plain-text rendering of a tooltip (for "copy tooltip"): title then one line per entry.
export function tipText(title: string, tip: Tip | null): string {
    const lines = [title];
    if (!tip) return title;
    if (tip.imprint) lines.push(tip.imprint);
    lines.push(...tip.props);
    for (const e of tip.enchants) {
        lines.push([e.slot, e.name, e.rank].filter(Boolean).join(' '));
        if (e.desc) lines.push(e.desc);
    }
    lines.push(...tip.bless, ...tip.relic);
    if (tip.relicDesc) lines.push(tip.relicDesc);
    lines.push(...tip.magicCircle, ...tip.upgrades);
    if (tip.special) lines.push(tip.special);
    if (tip.energy) lines.push(tip.energy);
    for (const m of tip.metalware) lines.push(`${m.name} ${m.level}/${m.max}${m.value ? ` ${m.value}` : ''}`);
    for (const g of tip.colorGroups) lines.push(`${g.label} ${g.colors.join(' ')}`);
    return lines.join('\n');
}

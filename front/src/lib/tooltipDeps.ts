// tooltipDeps.ts — shared builders for itemTooltip's TooltipDeps (items/equipment tabs).
import type { Holder, IndexItem } from './itemIndex';
import type { TooltipDeps } from './itemTooltip';
import type { EnchantInfo, ItemUpgrade, ManualForm, MetalwareAbility } from '@/store';

// itemNameMap values are "name id"; strip the trailing id.
export function itemName(map: Record<number, string>, id: number): string {
    const label = map[id];
    return label ? label.replace(/\s*\d+$/, '') : `Item ${id}`;
}

export interface TooltipMaps {
    itemNameMap: Record<number, string>;
    enchantNameMap: Record<number, string>;
    enchantInfoMap: Record<number, EnchantInfo>;
    metalwareMap: Record<number, MetalwareAbility>;
    manualFormMap: Record<number, ManualForm>;
    itemUpgradeMap: Record<number, ItemUpgrade>;
    // Relic item descriptions (pocket 32-35), id -> text.
    itemDescMap: Record<number, string>;
}

// Takes plain values (pass `.value` of the store refs); call again after maps change.
export function makeTooltipDeps(maps: TooltipMaps): TooltipDeps {
    return {
        enchantNameMap: maps.enchantNameMap,
        enchantInfoMap: maps.enchantInfoMap,
        metalwareMap: maps.metalwareMap,
        manualFormMap: maps.manualFormMap,
        itemUpgradeMap: maps.itemUpgradeMap,
        itemDescMap: maps.itemDescMap,
        itemName: (id: number) => itemName(maps.itemNameMap, id),
    };
}

// buildTip/displayName take a Holder; a worn item has no container owner.
export function asHolder(it: IndexItem, entity = '', master = ''): Holder {
    return { ...it, entity, master };
}

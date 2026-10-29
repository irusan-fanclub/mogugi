// entityView.ts — pure selectors for the characters tab.
import type { EntityActor, EntityBody, EntityCondition, EntityItem } from '@/eventActor';

// PCs sorted by name (the order the old characters tab used).
export function listPcEntities(entityMap: Record<string, EntityActor>): EntityActor[] {
    return Object.values(entityMap).filter(v => v.isPC).sort((a, b) => a.name.localeCompare(b.name));
}

export const sortedConditions = (v: { conditionMap: Record<number, EntityCondition> }): EntityCondition[] =>
    Object.values(v.conditionMap).sort((a, b) => a.CCId - b.CCId);

export const sortedEquip = (v: { equipItemMap: Record<number, EntityItem> }): EntityItem[] =>
    Object.values(v.equipItemMap).sort((a, b) => a.PocketType - b.PocketType);

export function bodyText(b: EntityBody): string {
    return `h: ${b.Height.toFixed(2)} w: ${b.Weight.toFixed(2)} u: ${b.Upper.toFixed(2)} l: ${b.Lower.toFixed(2)}`;
}

// Name maps store "name id"; drop the trailing id.
export function stripId(label: string | undefined, fallback: string): string {
    return label ? label.replace(/\s*\d+$/, '') : fallback;
}

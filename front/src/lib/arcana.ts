import { ARCANA_NAMES } from './arcanaTable';

/** One arcana per character per fight — the requirement rules out switching,
 *  so the first recognised skill settles it. */
export function arcanaIconUrl(id: number | null): string {
    // id 0 is the "not yet detected" placeholder icon, not a real arcana.
    return `/icons/arcana/icon_arcana_${id ?? 0}.png`;
}

export function deriveArcana(skillIds: number[], map: Record<number, number>): number | null {
    for (const id of skillIds) {
        const a = map[id];
        if (a !== undefined) return a;
    }
    return null;
}

// Every deriveArcana result comes from ARCANA_BY_SKILL, whose values are all
// keys of ARCANA_NAMES (arcanaTable.test.ts pins both) — only null is real.
export function arcanaTitle(arcana: number | null): string {
    return arcana !== null ? ARCANA_NAMES[arcana] : '尚未偵測到秘法技能';
}

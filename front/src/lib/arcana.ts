import { ARCANA_NAMES } from './arcanaTable';

export function arcanaIconUrl(id: number | null): string {
    // id 0 is the "not yet detected" placeholder icon, not a real arcana.
    return `/icons/arcana/icon_arcana_${id ?? 0}.png`;
}

/** The LAST recognised skill wins: arcana can be switched between dungeons
 *  within one session, so the most recent arcana skill reflects the current
 *  one — earlier fights must not pin a stale icon. */
export function deriveArcana(skillIds: number[], map: Record<number, number>): number | null {
    for (let i = skillIds.length - 1; i >= 0; i--) {
        const a = map[skillIds[i]];
        if (a !== undefined) return a;
    }
    return null;
}

// Every deriveArcana result comes from ARCANA_BY_SKILL, whose values are all
// keys of ARCANA_NAMES (arcanaTable.test.ts pins both) — only null is real.
export function arcanaTitle(arcana: number | null): string {
    return arcana !== null ? ARCANA_NAMES[arcana] : '尚未偵測到秘法技能';
}

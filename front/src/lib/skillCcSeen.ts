import { seenCCIds } from './ccTracking';

type History = Parameters<typeof seenCCIds>[0];
interface ActorLike { isPC: boolean; conditionHistory: History }

/** CC ids seen this session: on targets, on players, and per arcana (id -> player count). */
export interface SkillCcSeen {
    boss: Set<number>;
    common: Set<number>;
    arcana: Record<number, Map<number, number>>;
}

export const EMPTY_SKILL_CC_SEEN: SkillCcSeen = { boss: new Set(), common: new Set(), arcana: {} };

export function buildSkillCcSeen<A extends ActorLike>(actors: A[], arcanaOf: (a: A) => number | null): SkillCcSeen {
    const out: SkillCcSeen = { boss: new Set(), common: new Set(), arcana: {} };
    for (const a of actors) {
        const ids = seenCCIds(a.conditionHistory);
        if (!a.isPC) { for (const id of ids) out.boss.add(id); continue; }
        for (const id of ids) out.common.add(id);
        const arc = arcanaOf(a);
        if (arc === null) continue;
        const m = out.arcana[arc] ??= new Map();
        for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
    }
    return out;
}

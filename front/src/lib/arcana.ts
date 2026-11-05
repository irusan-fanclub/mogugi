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

interface SkillHit { At: number; SkillId: number }

/**
 * Each player's latest arcana, from both hits and skill uses. Reads only new entries,
 * and remembers what it saw, so a battle boundary that drops the old events keeps it.
 */
export function createArcanaTracker(map: Record<number, number>) {
    const known = new Map<string, { arcana: number; at: number }>();
    const read = new WeakMap<SkillHit[], { n: number; first: SkillHit | undefined }>();
    function scan(id: string, list: SkillHit[]) {
        let r = read.get(list);
        if (!r || list.length < r.n || list[0] !== r.first) r = { n: 0, first: list[0] };
        for (; r.n < list.length; r.n++) {
            const e = list[r.n];
            const a = map[e.SkillId];
            const cur = known.get(id);
            if (a !== undefined && (!cur || e.At >= cur.at)) known.set(id, { arcana: a, at: e.At });
        }
        read.set(list, r);
    }
    return {
        observe(actors: Iterable<{ id: string; isPC: boolean; applyDamages: SkillHit[]; skillUses: SkillHit[] }>) {
            for (const a of actors) {
                if (!a.isPC) continue;
                scan(a.id, a.applyDamages);
                scan(a.id, a.skillUses);
            }
        },
        /** Marks the lists read without taking an arcana from them (a replay). */
        skip(actors: Iterable<{ applyDamages: SkillHit[]; skillUses: SkillHit[] }>) {
            for (const a of actors) {
                for (const l of [a.applyDamages, a.skillUses]) read.set(l, { n: l.length, first: l[0] });
            }
        },
        of: (id: string): number | null => known.get(id)?.arcana ?? null,
        /** Forgets every player, for a new event source; lists already read are not read again. */
        reset() { known.clear(); },
    };
}

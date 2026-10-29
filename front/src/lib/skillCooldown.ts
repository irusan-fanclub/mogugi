import type { EntityActor } from '@/eventActor';

export const SKILL_COOLDOWNS: readonly { skillId: number; ccId: number; cooldownSec: number }[] = [
    { skillId: 59005, ccId: 803, cooldownSec: 180 },
];

// Casts closer than this to the previous counted one are the same use (several targets).
export const CAST_DEDUPE_SEC = 10;
// A row ready this long is dropped: its caster likely left or the run ended.
export const READY_KEEP_SEC = 300;

export interface CooldownRowVM { id: string; name: string; skillId: number; remaining: number; isSelf?: boolean }

export function buildCooldownRows(i: {
    actors: Record<string, EntityActor>; now: number; nameOf: (id: string) => string;
}): CooldownRowVM[] {
    const out: CooldownRowVM[] = [];
    for (const sk of SKILL_COOLDOWNS) {
        const byPc = new Map<string, number[]>();
        for (const a of Object.values(i.actors)) {
            if (a.isPC) continue;
            for (const c of a.casts) {
                if (c.CCId !== sk.ccId || !i.actors[c.AttackerId]?.isPC) continue;
                const l = byPc.get(c.AttackerId);
                if (l) l.push(c.At); else byPc.set(c.AttackerId, [c.At]);
            }
        }
        for (const [id, ats] of byPc) {
            ats.sort((x, y) => x - y);
            let last = ats[0];
            for (const t of ats) if (t - last >= CAST_DEDUPE_SEC) last = t;
            if (i.now - (last + sk.cooldownSec) > READY_KEEP_SEC) continue;
            out.push({
                id, name: i.nameOf(id), skillId: sk.skillId,
                remaining: Math.max(0, last + sk.cooldownSec - i.now),
            });
        }
    }
    return out.sort((a, b) => a.remaining - b.remaining || a.name.localeCompare(b.name));
}

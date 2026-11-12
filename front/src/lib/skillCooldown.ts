import type { EntityActor } from '@/eventActor';
import type { CooldownSkill } from './overlaySettings';
import { NO_TUAIRIM_RESET } from './skillTags.gen';

// 信念值強化: starting it makes the player's tracked cooldowns ready.
export const COOLDOWN_RESET_CC = 428;

// Casts closer than this to the previous counted one are the same use (several targets).
export const CAST_DEDUPE_SEC = 10;
// A row ready this long is dropped: its caster likely left or the run ended.
export const READY_KEEP_SEC = 300;
// A use of a skill not in the list is kept this long, in case it gets enabled.
export const UNTRACKED_KEEP_SEC = 1800;

// Skills timed by the CC they put on a non-PC; some (魔力封鎖) send no skill-use event at all.
export const SKILL_TRIGGER_CC: Readonly<Record<number, number>> = { 59005: 803, 59045: 931 };
const withTrigger = (s: CooldownSkill): CooldownSkill =>
    s.ccId > 0 || !SKILL_TRIGGER_CC[s.skillId] ? s : { ...s, ccId: SKILL_TRIGGER_CC[s.skillId] };

export interface CooldownIconVM { skillId: number; remaining: number; total: number }
export interface CooldownRowVM { id: string; name: string; isSelf?: boolean; skills: CooldownIconVM[] }

const dedupeOf = (cd: number | undefined) => cd === undefined ? CAST_DEDUPE_SEC : Math.min(CAST_DEDUPE_SEC, cd / 2);

// skill id (or CC id) → pc id → last counted use
type Uses = Map<number, Map<string, number>>;

/**
 * Latest counted use of every skill (and every CC a PC put on a non-PC) per PC. It keeps
 * what it has seen, so the rows outlive actor history evicted at a battle boundary.
 */
export function createCooldownTracker() {
    const uses: Uses = new Map();
    const ccUses: Uses = new Map();
    // pcId → latest 428 start; a use at or before it is ready
    const reset = new Map<string, number>();
    const names = new Map<string, string>();
    // Per event list: how far it was read, and its first entry (eviction drops the front).
    const read = new WeakMap<object, { n: number; first: unknown }>();
    function unread<T>(list: T[]): T[] {
        const r = read.get(list);
        const from = r && r.first === list[0] && list.length >= r.n ? r.n : 0;
        read.set(list, { n: list.length, first: list[0] });
        return from === 0 ? list : list.slice(from);
    }

    function count(m: Uses, id: number, pc: string, at: number, cd: number | undefined) {
        let byPc = m.get(id);
        if (!byPc) m.set(id, byPc = new Map());
        const prev = byPc.get(pc);
        if (prev === undefined || at - prev >= dedupeOf(cd)) byPc.set(pc, at);
    }

    function observe(actors: Record<string, EntityActor>, list: CooldownSkill[], nameOf: (id: string) => string) {
        const skills = list.map(withTrigger);
        const castCd = new Map(skills.filter(s => s.ccId === 0).map(s => [s.skillId, s.cooldownSec]));
        const ccCd = new Map(skills.filter(s => s.ccId > 0).map(s => [s.ccId, s.cooldownSec]));
        // Re-reading a list (after eviction) is harmless: an equal time never moves a use.
        for (const a of Object.values(actors)) {
            if (a.isPC) {
                names.set(a.id, nameOf(a.id));
                for (const u of unread(a.skillUses)) count(uses, u.SkillId, a.id, u.At, castCd.get(u.SkillId));
                for (const c of unread(a.casts)) {
                    if (c.CCId === COOLDOWN_RESET_CC) reset.set(a.id, Math.max(reset.get(a.id) ?? 0, c.At));
                }
            } else {
                for (const c of unread(a.casts)) {
                    if (actors[c.AttackerId]?.isPC) count(ccUses, c.CCId, c.AttackerId, c.At, ccCd.get(c.CCId));
                }
            }
        }
    }

    // Drops uses long past ready; an untracked skill's cooldown is unknown.
    function prune(m: Uses, cdOf: Map<number, number>, now: number) {
        for (const [id, byPc] of m) {
            const cd = cdOf.get(id);
            const keep = cd === undefined ? UNTRACKED_KEEP_SEC : cd + READY_KEEP_SEC;
            for (const [pc, at] of byPc) if (now - at > keep) byPc.delete(pc);
            if (byPc.size === 0) m.delete(id);
        }
    }

    function rows(now: number, list: CooldownSkill[], ownerId: string): CooldownRowVM[] {
        const skills = list.map(withTrigger);
        prune(uses, new Map(skills.filter(s => s.ccId === 0).map(s => [s.skillId, s.cooldownSec])), now);
        prune(ccUses, new Map(skills.filter(s => s.ccId > 0).map(s => [s.ccId, s.cooldownSec])), now);
        const byPc = new Map<string, CooldownIconVM[]>();
        for (const sk of skills) {
            const seen = sk.ccId > 0 ? ccUses.get(sk.ccId) : uses.get(sk.skillId);
            if (!seen) continue;
            for (const [pc, at] of seen) {
                const r = reset.get(pc);
                const readyAt = r !== undefined && r >= at && !NO_TUAIRIM_RESET.has(sk.skillId) ? Math.min(r, at + sk.cooldownSec) : at + sk.cooldownSec;
                const remaining = Math.max(0, readyAt - now);
                if (now - readyAt > READY_KEEP_SEC) continue;
                const l = byPc.get(pc) ?? [];
                l.push({ skillId: sk.skillId, remaining, total: sk.cooldownSec });
                byPc.set(pc, l);
            }
        }
        const out = [...byPc].map(([id, list]) => ({ id, name: names.get(id) ?? id, isSelf: id === ownerId, skills: list }));
        const soonest = (r: CooldownRowVM) => Math.min(...r.skills.map(s => s.remaining));
        return out.sort((a, b) => Number(b.isSelf) - Number(a.isSelf) || soonest(a) - soonest(b) || a.name.localeCompare(b.name));
    }

    /**
     * Forgets every use, for a new event source. Read marks stay: actor cast lists outlive
     * ActorManager.clear(), and the old source's entries must not be counted again.
     */
    function clear() { uses.clear(); ccUses.clear(); reset.clear(); names.clear(); }
    /** Marks every list read without counting: data that must not reach the rows (a replay). */
    function skip(actors: Record<string, EntityActor>) {
        for (const a of Object.values(actors)) { unread(a.skillUses); unread(a.casts); }
    }
    /** Number of stored uses (for tests). */
    const size = () => [...uses.values(), ...ccUses.values()].reduce((n, m) => n + m.size, 0);

    return { observe, skip, rows, reset: clear, size };
}

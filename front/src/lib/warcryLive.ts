import type { EntityActor, EntityCondition } from '@/eventActor';
import type { eventBardsong, eventBardsongPulse } from '@/protocols';
import { BARDSONG_CC_ID, BARDSONG_PULSE_SEC } from './bardsongTrack';

// A performer still singing re-pulses every 10-11 s; past this with no pulse they stopped.
export const REPULSE_SEC = 12;
// Seconds until a singing performer's next pulse, which grants another 20 s.
const NEXT_PULSE_SEC = 10;

interface Run { start: number; last: number; performer: string; endAt: number | null }

/**
 * The live 戰吼 buff of every entity the pulse lists reached, as a synthetic CC 900206.
 * While the performer keeps singing, the expiry counts the next pulse in (+20 s), so a
 * countdown only fires once the song is no longer refreshing them.
 */
export function warcryConditions(
    pulses: readonly eventBardsongPulse[], events: readonly eventBardsong[], ownerId: string, now: number,
): Map<string, EntityCondition> {
    const runs = new Map<string, Run>();
    const lastPulse = new Map<string, number>();
    const stopped = new Map<string, number>();
    for (const p of pulses) {
        if (p.At > now) break;
        if (p.Stop) { stopped.set(p.Id, p.At); continue; }
        if (p.Targets.length === 0) continue;
        lastPulse.set(p.Id, p.At);
        stopped.delete(p.Id);
        for (const t of p.Targets) {
            const r = runs.get(t);
            if (!r || p.At >= (r.endAt ?? r.last + BARDSONG_PULSE_SEC)) runs.set(t, { start: p.At, last: p.At, performer: p.Id, endAt: null });
            else { r.last = p.At; r.performer = p.Id; r.endAt = null; }
        }
    }
    // The end notice reaches only the local player.
    const own = runs.get(ownerId);
    if (own) for (const e of events) if (e.IsEnd && e.At >= own.last && e.At <= now) { own.endAt = e.At; break; }

    const out = new Map<string, EntityCondition>();
    for (const [id, r] of runs) {
        const singing = !stopped.has(r.performer) && lastPulse.get(r.performer) === r.last && now - r.last < REPULSE_SEC;
        const until = r.endAt ?? r.last + BARDSONG_PULSE_SEC + (singing ? NEXT_PULSE_SEC : 0);
        if (until <= now) continue;
        out.set(id, {
            Id: '', At: r.start, CCId: BARDSONG_CC_ID, DisableAt: until, AttackerId: r.performer, Params: {},
            // Keeps the alert's cast key (DisableAt - Shifted) fixed for the whole run.
            Shifted: until - (r.start + BARDSONG_PULSE_SEC),
        });
    }
    return out;
}

/** `actors` with the synthetic conditions added; untouched actors are the same objects. */
export function withConditions(
    actors: Record<string, EntityActor>, extra: Map<string, EntityCondition>,
): Record<string, EntityActor> {
    if (extra.size === 0) return actors;
    const out = { ...actors };
    for (const [id, c] of extra) {
        const a = actors[id];
        if (!a || a.conditionMap[c.CCId]) continue;
        // conditionMap is a getter on the class, so it is shadowed with an own property.
        out[id] = Object.create(a, { conditionMap: { value: { ...a.conditionMap, [c.CCId]: c } } }) as EntityActor;
    }
    return out;
}

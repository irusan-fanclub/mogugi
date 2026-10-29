import type { EntityActor } from '@/eventActor';

export interface BossInfoVM {
    name: string; hpPct: number | null; life: number; maxLife: number;
    dealt: number; dead: boolean; fightSec: number | null; partyDps: number;
}

/** Last death toggle at or before `at` (null = latest) says dead. */
function isDeadAt(history: { At: number; Dead: boolean }[], at: number | null): boolean {
    for (let i = history.length - 1; i >= 0; i--) {
        if (at === null || history[i].At <= at) return history[i].Dead;
    }
    return false;
}

/** Boss bar model: sampled life wins, else maxLife - dealt; null unless a boss with life data. */
export function bossInfoOf(i: {
    target: EntityActor | null; isBoss(race: number): boolean; name: string; dealt: number;
    at: number | null; stats: { fightSec: number | null; partyDps: number };
}): BossInfoVM | null {
    const t = i.target;
    if (!t || !i.isBoss(t.raceId)) return null;
    const sampled = t.lifeAt(i.at);
    const maxLife = t.maxLife ?? 0;
    if (!maxLife && sampled === undefined) return null;
    // Player death toggles, a boss EntityDown (the only kill signal in saved records),
    // or a sampled life of 0.
    const downAt = t.downAt;
    // A positive life sample after the down (dummy / fake death) revives the boss.
    const down = downAt != null && (i.at === null || downAt <= i.at)
        && !t.lifeHistory.some(s => s.At > downAt && s.Life > 0 && (i.at === null || s.At <= i.at));
    const dead = isDeadAt(t.deathHistory, i.at) || down || (sampled !== undefined && sampled <= 0);
    const life = dead ? 0 : Math.max(0, sampled ?? maxLife - i.dealt);
    const hpPct = maxLife > 0 ? Math.round(Math.min(100, life / maxLife * 100) * 10) / 10 : null;
    return { name: i.name, hpPct, life, maxLife, dealt: i.dealt, dead, ...i.stats };
}

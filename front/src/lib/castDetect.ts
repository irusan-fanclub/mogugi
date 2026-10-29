import type { EntityCondition } from '@/eventActor';

export interface CastRecord {
    CCId: number;
    At: number;
    AttackerId: string;
}

// The game re-sends active conditions constantly and nudges the server end time
// (SBT) by under a second; only a larger move, or a DisableAt move, is a new cast.
export function isCast(prev: EntityCondition | undefined, now: EntityCondition): boolean {
    if (!prev) return true;
    const a = Number(prev.Params?.SBT);
    const b = Number(now.Params?.SBT);
    if (prev.Params?.SBT !== undefined && now.Params?.SBT !== undefined && Number.isFinite(a) && Number.isFinite(b)) {
        return Math.abs(a - b) >= 1000;
    }
    return Math.abs(prev.DisableAt - now.DisableAt) >= 1.0;
}

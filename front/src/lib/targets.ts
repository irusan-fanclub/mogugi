import type { EntityActor } from '@/eventActor';
import { humanReadableNumber, stripRaceSuffix, formatUnixLocal } from './util';

export interface BuildTargetListInput {
    totals: Record<string, number>;
    total: number;
    hiddenIds: Set<string>;
    hiddenRaces: Set<number>;
    bossOnly: boolean;
    /** Race of a target id; use -1 for unknown. */
    raceOf: (id: string) => number;
    isBoss: (race: number) => boolean;
    /** Players and their pets are never listed as targets. */
    isAlly?: (id: string) => boolean;
}

/** '' (all) first, then targets by damage desc, minus hidden ones. */
export function buildTargetList(input: BuildTargetListInput): [string, number][] {
    const list: [string, number][] = Object.entries(input.totals)
        .sort(([, av], [, bv]) => bv - av);
    list.unshift(['', input.total]);
    let out = list.filter(([id]) => !id || !(input.isAlly?.(id)
        || input.hiddenIds.has(id) || input.hiddenRaces.has(input.raceOf(id))));
    if (input.bossOnly) out = out.filter(([id]) => !id || input.isBoss(input.raceOf(id)));
    return out;
}

/** Hides the whole race when it is known (> 0), else just that id. Mutates state. */
export function hideTarget(
    state: { ids: Set<string>; races: Set<number> },
    id: string,
    raceOf: (id: string) => number,
): void {
    const race = raceOf(id);
    if (race > 0) state.races.add(race);
    else state.ids.add(id);
}

/** Last boss id in `ids` not yet in `seen` (which is updated), else null. */
export function pickNewBoss(ids: string[], seen: Set<string>, isBossId: (id: string) => boolean): string | null {
    let picked: string | null = null;
    for (const id of ids) {
        if (seen.has(id)) continue;
        if (!isBossId(id)) continue;
        seen.add(id);
        picked = id;
    }
    return picked;
}

export interface TargetLabelOpts {
    isBossRace: (race: number) => boolean;
    raceName: (race: number) => string | undefined;
    prettyName: (actor?: EntityActor) => string | undefined;
    /** No killing-blow flag in this session (an older log): judge kills by the finisher instead. */
    finisherFallback?: boolean;
}

/**
 * Killed by a down (boss) or a killing blow. Logs older than the killing-blow flag fall back to
 * "a finisher was ever set", which matches about three kills in four.
 */
export const isKilled = (a: EntityActor, fallback = false) =>
    a.downAt != null || a.killedAt != null || (fallback && a.everFinished);

/** Target-select entry text, the same for bosses and mobs: "time name (race) -- HP ✅/❌". */
export function targetLabel(entry: [string, number], actor: EntityActor | undefined, opts: TargetLabelOpts): string {
    const [id, dmg] = entry;
    if (!id) return `全部目標（傷害 ${humanReadableNumber(dmg || 0)}）`;
    if (!actor) return id;
    const parts: string[] = [];
    if (actor.appearAt !== undefined) parts.push(formatUnixLocal(actor.appearAt));
    parts.push(`${stripRaceSuffix(actor.raceId, opts.raceName(actor.raceId) ?? opts.prettyName(actor))} (${actor.raceId})`);
    if (actor.maxLife !== undefined) parts.push(`-- ${humanReadableNumber(actor.maxLife)}`);
    parts.push(isKilled(actor, opts.finisherFallback) ? '✅' : '❌');
    return parts.join(' ');
}


/** Closed-box text, in the menu's order: "date time name" (no HP); a boss is named by its race. */
export function targetShortLabel(actor: EntityActor | undefined, opts: TargetLabelOpts): string {
    if (!actor) return '';
    const name = opts.isBossRace(actor.raceId)
        ? stripRaceSuffix(actor.raceId, opts.raceName(actor.raceId))
        : opts.prettyName(actor) ?? '';
    return actor.appearAt === undefined ? name : `${formatUnixLocal(actor.appearAt)} ${name}`;
}

/** Title-bar boss: the selected target if a boss, else the latest-appeared boss. */
export function titleBoss(input: {
    selected: EntityActor | null;
    actors: Record<string, EntityActor>;
    isBoss: (race: number) => boolean;
}): EntityActor | null {
    const sel = input.selected;
    if (sel && input.isBoss(sel.raceId)) return sel;
    let best: EntityActor | null = null;
    for (const id in input.actors) {
        const a = input.actors[id];
        if (!input.isBoss(a.raceId)) continue;
        if (!best || (a.appearAt ?? 0) > (best.appearAt ?? 0)) best = a;
    }
    return best;
}

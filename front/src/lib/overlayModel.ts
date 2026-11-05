import type { EntityActor, EntityCondition } from '@/eventActor';
import { dpsOf, shareOf, type PlayerDamage } from './battleStats';
import { titleBoss } from './targets';
import { fightSpan, mergedIds } from './effectTimeline';

/** Announced target wins ('' = all targets); otherwise the latest boss, else all targets. */
export function resolveOverlayTarget(i: {
    announced: string | null; actors: Record<string, EntityActor>; isBoss: (race: number) => boolean;
}): string {
    if (i.announced !== null) return i.announced;
    return titleBoss({ selected: null, actors: i.actors, isBoss: i.isBoss })?.id ?? '';
}

export interface DpsRowVM { id: string; name: string; dps: number; total: number; share: number; isSelf: boolean }
export interface DpsOverlayVM {
    boss: { name: string; hpPct: number | null; life: number | null } | null;
    fightSec: number | null;
    partyDps: number;
    rows: DpsRowVM[];
}

/** Fight length and whole-party DPS over the rows' hits. */
export function fightStats(rows: { damages: { At: number }[]; totalDamage: number }[]): { fightSec: number | null; partyDps: number } {
    const span = fightSpan(rows);
    const fightSec = span ? span.end - span.start : null;
    const all = rows.reduce((s, r) => s + r.totalDamage, 0);
    return { fightSec, partyDps: fightSec ? all / fightSec : 0 };
}

export function buildDpsOverlay(i: {
    rows: PlayerDamage[]; ownerId: string; nameOf: (id: string) => string;
    boss: { name: string; maxLife: number; dealt: number; life?: number } | null;
}): DpsOverlayVM {
    const all = i.rows.reduce((s, r) => s + r.totalDamage, 0);
    const { fightSec, partyDps } = fightStats(i.rows);
    const boss = i.boss && {
        name: i.boss.name,
        life: i.boss.maxLife > 0
            ? Math.min(i.boss.maxLife, Math.max(0, i.boss.life ?? i.boss.maxLife - i.boss.dealt)) : null,
        hpPct: i.boss.maxLife > 0
            ? Math.min(100, Math.max(0, (i.boss.life ?? i.boss.maxLife - i.boss.dealt) / i.boss.maxLife * 100)) : null,
    };
    return {
        boss,
        fightSec,
        partyDps,
        rows: i.rows.map(r => ({
            id: r.actor.id,
            name: i.nameOf(r.actor.id),
            dps: dpsOf(r.totalDamage, r.damages),
            total: r.totalDamage,
            share: shareOf(r.totalDamage, all),
            isSelf: r.actor.id === i.ownerId,
        })),
    };
}

export interface CcIconVM { ccId: number; disableAt: number; remaining: number | null; expiring: boolean }

const EXPIRING_SEC = 3;

/** The condition for `ccId` (or a merged alias) that is present and not past DisableAt. */
export function activeCondition(conditions: Record<number, EntityCondition>, ccId: number, now: number): EntityCondition | undefined {
    for (const id of mergedIds(ccId)) {
        const c = conditions[id];
        if (c && (c.DisableAt === 0 || c.DisableAt > now)) return c;
    }
    return undefined;
}

/** Tracked ids that are active (directly or via a merged alias) and not past DisableAt. */
export function activeIcons(
    conditions: Record<number, EntityCondition>, tracked: number[], now: number, red?: (ccId: number) => boolean,
): CcIconVM[] {
    const out: CcIconVM[] = [];
    for (const t of tracked) {
        const cond = activeCondition(conditions, t, now);
        if (!cond) continue;
        const remaining = cond.DisableAt === 0 ? null : cond.DisableAt - now;
        out.push({
            ccId: t, disableAt: cond.DisableAt, remaining,
            expiring: (remaining !== null && remaining <= EXPIRING_SEC) || (red?.(t) ?? false),
        });
    }
    return out;
}

export function formatRemaining(sec: number): string {
    const s = Math.ceil(sec);
    if (s < 100) return String(s);
    if (s < 6000) return `${Math.ceil(s / 60)}m`;
    return '';
}

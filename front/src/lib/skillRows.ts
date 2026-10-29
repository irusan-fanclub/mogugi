import type { EntityDamage } from '@/eventActor';
import { countsTowardStats } from '@/actionCollector';
import { computeCritStats } from './critStats';
import { humanReadableNumber } from './util';

// A stat over no samples is unknown, not zero: '-' instead of '0K'.
const statOf = (n: number, v: number) => (n > 0 ? humanReadableNumber(v) : '-');
import { dpsOf } from './battleStats';
import { isExcluded, type Span } from './activeDps';

export interface SkillRow {
    skillId: number;
    name: string;
    damage: number;
    count: number;
    /** The hits counted in `count`. */
    hits: EntityDamage[];
    dps: number;
    /** damage / the player's active seconds; null when those are unknown. */
    activeDps: number | null;
    /** damage / player total, 0..1 */
    share: number;
    /** Pre-formatted text per optional column, keyed by DETAIL_COLUMNS. */
    cells: Record<string, string>;
}

export interface SkillRowsInput {
    damages: EntityDamage[];
    skillUses: { SkillId: number; At: number }[];
    showPet: boolean;
    minAt: number | null;
    maxAt: number | null;
    skillName: (id: number) => string;
    /** The player's own first-to-last damage span, in seconds. */
    playerSpanSec: number;
    /** The player's active seconds (the activeDps denominator); null when unknown. */
    activeSec?: number | null;
    /** The player's excluded spans; their hits stay out of the active numerator. */
    excluded?: Span[];
    /** Share denominator; defaults to the sum over all skills (pets included). */
    totalDamage?: number;
}

export function buildSkillRows(input: SkillRowsInput): SkillRow[] {
    const { minAt, maxAt, playerSpanSec: span } = input;
    // Cast counts come from skill-use events under the same time range.
    const casts = new Map<number, number>();
    for (const u of input.skillUses) {
        if (minAt !== null && maxAt !== null && (u.At < minAt || u.At > maxAt)) continue;
        casts.set(u.SkillId, (casts.get(u.SkillId) ?? 0) + 1);
    }
    // Integer keys iterate ascending, matching the collector's grouped maps.
    const grouped: Record<number, EntityDamage[]> = {};
    for (const d of input.damages) (grouped[d.SkillId] ??= []).push(d);
    let all = input.totalDamage;
    if (all === undefined) {
        all = 0;
        for (const d of input.damages) all += d.Damage;
    }

    return Object.keys(grouped)
        .map((key) => {
            const skillId = +key;
            // A pet's damage is redirected onto its owner and tagged;
            // a summon (人偶) is the owner's own output and never is.
            const damages = input.showPet ? grouped[skillId] : grouped[skillId].filter(d => d.PetId === '');
            const crit = computeCritStats(damages);

            // One pass: a spread into Math.min blows the stack on long sessions.
            let count = 0, damage = 0, min = 0, max = 0;
            const hits: EntityDamage[] = [];
            for (const d of damages) {
                damage += d.Damage;
                if (!countsTowardStats(d)) continue;
                if (count === 0 || d.Damage < min) min = d.Damage;
                if (count === 0 || d.Damage > max) max = d.Damage;
                count++;
                hits.push(d);
            }
            let activeDmg = 0;
            for (const d of damages) if (!isExcluded(d.At, input.excluded ?? [])) activeDmg += d.Damage;
            return {
                skillId,
                name: input.skillName(skillId),
                damage,
                count,
                hits,
                dps: dpsOf(damage, damages),
                activeDps: input.activeSec && input.activeSec > 0 ? activeDmg / input.activeSec : null,
                share: all! > 0 ? damage / all! : 0,
                cells: {
                    critRate: `${(100 * crit.rate).toFixed(1)}%`,
                    hitsPerMin: span > 0 ? (count * 60 / span).toFixed(1) : '-',
                    // '-' rather than 0: unseen casts must not read as "zero casts".
                    castCount: casts.get(skillId) ? String(casts.get(skillId)) : '-',
                    // Counts stay bare: humanReadableNumber would turn 47 into 0.05K.
                    critCount: String(crit.critCount),
                    normalCount: String(crit.normalCount),
                    avg: statOf(count, count ? damage / count : 0),
                    critAvg: statOf(crit.critCount, crit.critAvg),
                    normalAvg: statOf(crit.normalCount, crit.normalAvg),
                    min: statOf(count, min),
                    max: statOf(count, max),
                    critMin: statOf(crit.critCount, crit.critMin),
                    critMax: statOf(crit.critCount, crit.critMax),
                    normalMin: statOf(crit.normalCount, crit.normalMin),
                    normalMax: statOf(crit.normalCount, crit.normalMax),
                    critSummary: `${statOf(crit.critCount, crit.critAvg)} (${crit.critCount}, ${statOf(crit.critCount, crit.critMin)} ~ ${statOf(crit.critCount, crit.critMax)})`,
                    normalSummary: `${statOf(crit.normalCount, crit.normalAvg)} (${crit.normalCount}, ${statOf(crit.normalCount, crit.normalMin)} ~ ${statOf(crit.normalCount, crit.normalMax)})`,
                } as Record<string, string>,
            };
        })
        .filter(r => r.damage > 0)
        .sort((a, b) => b.damage - a.damage);
}

/** Row-limit setting with a per-player "show all" override. */
export function limitRows(rows: SkillRow[], limit: number, expanded: boolean): { rows: SkillRow[]; hidden: number } {
    if (limit <= 0 || expanded) return { rows, hidden: 0 };
    return { rows: rows.slice(0, limit), hidden: Math.max(0, rows.length - limit) };
}

import type { EntityCondition, EntityDamage } from '@/eventActor';
import type { ChartSpec } from '@/lib/chartProtocol';
import { condNameMap } from '@/store';
import { humanReadableNumber } from '@/lib/util';
import { inTimeRange, playerBucket, rangeKey, skillBucket } from './hubSources';
import type { KindProvider } from './hubTypes';

export interface HitLogCond { id: number; name: string }
export interface HitLogHit {
    at: number;
    skillIcon: string;
    skillName: string;
    /** Already formatted. */
    damage: string;
    crit: boolean;
    delayed: boolean;
    cond: HitLogCond[];
    targetCond: HitLogCond[];
}
export interface HitLogPayload { header: string; hits: HitLogHit[] }

/** Most recent hits sent per window; the rest would make every update megabytes of IPC. */
export const MAX_HITS = 5000;

const condList = (list: EntityCondition[]): HitLogCond[] => list
    .map(c => ({ id: c.CCId, name: condNameMap.value[c.CCId] ?? `CC ${c.CCId}` }));

/**
 * A skill log is the collector bucket and ignores the time range (as the old row
 * click did); the all-hits log follows the target and the time range.
 */
export const hitlogProvider: KindProvider = (spec: ChartSpec, _opts, env) => {
    if (spec.kind !== 'hitlog') return null;
    const { attackerId, targetId, skillId } = spec;
    const dc = env.collector(attackerId);
    const { damages, sum } = skillId === undefined ? playerBucket(dc, targetId) : skillBucket(dc, targetId, skillId);
    const subject = skillId === undefined ? 'All' : env.skillName(skillId);
    const title = `${env.actorName(attackerId)} -> ${subject}`;
    const range = skillId === undefined ? rangeKey() : '';

    return {
        title,
        key: ['hit', damages.length, sum, damages[0]?.At, damages[damages.length - 1]?.At, targetId, skillId, range, title].join('|'),
        build: (): HitLogPayload => {
            const all: EntityDamage[] = skillId === undefined ? inTimeRange(damages) : damages;
            const shown = all.length > MAX_HITS ? all.slice(all.length - MAX_HITS) : all;
            return {
                header: all.length > MAX_HITS ? `${title} （最近 ${MAX_HITS} 筆，共 ${all.length} 筆）` : title,
                hits: shown.map(d => ({
                    at: d.At,
                    skillIcon: `/icons/skill/${d.SkillId}.png`,
                    skillName: env.skillName(d.SkillId),
                    damage: humanReadableNumber(d.Damage),
                    crit: d.IsCritical,
                    delayed: d.IsDelayed,
                    cond: condList(d.Conditions),
                    targetCond: condList(d.TargetConditions),
                })),
            };
        },
    };
};

import type { EntityDamage } from '@/eventActor';
import type { Span } from '@/lib/activeDps';
import type { MusicBuffCell } from '@/lib/musicBuff';

/** One player row as the list renders it. */
export interface PlayerVM {
    id: string;
    /** Real character name: the key for expansion state and aliases. */
    realName: string;
    /** Name as displayed (alias or real). */
    name: string;
    arcana: number | null;
    arcanaHidden: boolean;
    total: number;
    spanSec: number;
    dps: number;
    /** DPS without the opening and boss invincibility; null when no time remains. */
    activeDps: number | null;
    /** The seconds behind activeDps; null when no time remains. */
    activeSec: number | null;
    /** Spans left out of activeDps; skill rows apply the same ones. */
    excluded?: Span[];
    /** 0..1 */
    share: number;
    music: MusicBuffCell;
    hasCondition: boolean;
    /** Target/time-filtered hits, first to last. */
    damages: EntityDamage[];
    skillUses: { SkillId: number; At: number }[];
}


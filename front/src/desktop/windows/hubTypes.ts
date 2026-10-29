import type { DualGroupedDamageCollector } from '@/actionCollector';
import type { ChartOpts, ChartSpec } from '@/lib/chartProtocol';

/** What a provider returns for one window: a cheap change key plus a lazy payload builder. */
export interface ChartInputs {
    title: string;
    /** Hashed into ChartData.version; must change whenever the payload would. */
    key: string;
    build: () => unknown;
}

/** Main-window state a provider may read. */
export interface HubEnv {
    /** Per-attacker collector (grouped by target then skill), shared and released by the hub. */
    collector: (attackerId: string) => DualGroupedDamageCollector;
    /** The battle tab's selected target, '' for all. */
    targetId: () => string;
    actorName: (id: string) => string;
    skillName: (id: number) => string;
}

/** Return null when the spec is not this provider's. */
export type KindProvider = (spec: ChartSpec, opts: ChartOpts, env: HubEnv) => ChartInputs | null;

// Boss race ids for the damage tab (auto-select, boss-only target filter).
// The built-in list is code; the user's additions/removals live in the
// browser config and are applied on top, so a later release can grow the
// built-in list without losing or resurrecting the user's edits.

// Race.xml ids incl. phase/difficulty variants: 木頭人 4856-4860, 布里萊赫
// 7600-7603/7615, 喀輪巴斯深淵 佩洛姆 193810/193818 (its NPC forms
// 193369/193402/193432 are not fights).
export const DEFAULT_BOSS_RACE_IDS: readonly number[] = [
    4856, 4857, 4858, 4859, 4860, 7600, 7601, 7602, 7603, 7615, 193810, 193818,
];

export interface BossRaceOverrides {
    added: number[];
    removed: number[];
}

const isRaceId = (id: number) => Number.isInteger(id) && id > 0;

export function effectiveBossRaces(o: BossRaceOverrides, defaults: readonly number[] = DEFAULT_BOSS_RACE_IDS): Set<number> {
    const s = new Set<number>(defaults);
    for (const id of o.added) s.add(id);
    for (const id of o.removed) s.delete(id);
    return s;
}

// Re-adding a removed default only clears the removal; a foreign id is
// recorded once in `added`. Non-positive or fractional ids are ignored.
export function addBossRace(o: BossRaceOverrides, id: number): BossRaceOverrides {
    if (!isRaceId(id)) return o;
    if (o.removed.includes(id)) return { added: o.added, removed: o.removed.filter(x => x !== id) };
    if (DEFAULT_BOSS_RACE_IDS.includes(id) || o.added.includes(id)) return o;
    return { added: [...o.added, id], removed: o.removed };
}

// Removing a user-added id drops it; removing a default records the removal.
export function removeBossRace(o: BossRaceOverrides, id: number): BossRaceOverrides {
    if (o.added.includes(id)) return { added: o.added.filter(x => x !== id), removed: o.removed };
    if (!DEFAULT_BOSS_RACE_IDS.includes(id) || o.removed.includes(id)) return o;
    return { added: o.added, removed: [...o.removed, id] };
}

export function hasBossRaceOverrides(o: BossRaceOverrides): boolean {
    return o.added.length > 0 || o.removed.length > 0;
}

// Search filter for the race picker: a name fragment (case-insensitive)
// or a RaceID prefix; blank matches everything.
export function matchesRaceQuery(title: string, id: number, query: string): boolean {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (/^\d+$/.test(q)) return String(id).startsWith(q);
    return title.toLowerCase().includes(q);
}

// A typed value that is a bare positive integer, for adding an id the
// bundled race table does not know; null otherwise.
export function parseRaceIdInput(text: string): number | null {
    const s = text.trim();
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return n > 0 ? n : null;
}

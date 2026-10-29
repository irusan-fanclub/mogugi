export interface PlusInput {
    targetSeen: Set<number>;
    selfSeen: Set<number>;
    boss: number[];
    common: number[];
    arcana: number[] | null;
}

const asc = (s: Iterable<number>) => [...s].sort((a, b) => a - b);

// Seen CCs missing from one tracked list, ascending.
export const untrackedSeen = (seen: Iterable<number>, tracked: Iterable<number>): number[] => {
    const t = new Set(tracked);
    return asc([...seen].filter(id => !t.has(id)));
};

// Seen-but-untracked CCs; a self CC already in common or arcana is not offered again.
export function plusCandidates(i: PlusInput): { boss: number[]; self: number[] } {
    const boss = new Set(i.boss);
    const selfTracked = new Set([...i.common, ...(i.arcana ?? [])]);
    return {
        boss: untrackedSeen(i.targetSeen, boss),
        self: untrackedSeen(i.selfSeen, selfTracked),
    };
}

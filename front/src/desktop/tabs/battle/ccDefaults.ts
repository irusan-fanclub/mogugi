import { DEFAULT_CC_LIST, DEFAULT_CHART_HIDDEN, DEFAULT_SELF_CC_LIST, DEFAULT_SELF_CHART_HIDDEN } from '@/lib/ccTracking';
import { defaultSkillCcModel } from '@/lib/skillCcLists';
import { chartHiddenCCIds, resetCCTracking, selfChartHiddenCCIds, selfTrackedCCIds, trackedCCIds } from './ccSettings';
import { resetSkillCcModel, skillCcModel } from './skillCcSettings';

// The CC defaults as one comparable value: lists keep their order, coverage-only sets are sorted.
const sorted = (ids: Iterable<number>) => [...ids].sort((a, b) => a - b);
function snapshot(lists: { boss: number[]; bossHidden: Iterable<number>; self: number[]; selfHidden: Iterable<number>; skill: unknown }) {
    return JSON.stringify([lists.boss, sorted(lists.bossHidden), lists.self, sorted(lists.selfHidden), lists.skill]);
}
const defaultsSnapshot = () => snapshot({
    boss: DEFAULT_CC_LIST, bossHidden: DEFAULT_CHART_HIDDEN, self: DEFAULT_SELF_CC_LIST,
    selfHidden: DEFAULT_SELF_CHART_HIDDEN, skill: defaultSkillCcModel(),
});

/** A short id of the current defaults (FNV-1a), stored to notice when a release changes them. */
export function ccDefaultsFingerprint(): string {
    let h = 0x811c9dc5;
    for (const ch of defaultsSnapshot()) {
        h ^= ch.charCodeAt(0);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/** True when the BOSS, 自身 or skill-table CC lists are not the defaults. */
export function ccDiffersFromDefaults(): boolean {
    return snapshot({
        boss: trackedCCIds.value, bossHidden: chartHiddenCCIds.value, self: selfTrackedCCIds.value,
        selfHidden: selfChartHiddenCCIds.value, skill: skillCcModel.value,
    }) !== defaultsSnapshot();
}

export function resetCcToDefaults() {
    resetCCTracking();
    resetSkillCcModel();
}

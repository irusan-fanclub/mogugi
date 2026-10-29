import { ref } from 'vue';
import { settingsStorage } from '@/lib/settingsStorage';
import {
    DEFAULT_CC_LIST, DEFAULT_CHART_HIDDEN, DEFAULT_SELF_CC_LIST, DEFAULT_SELF_CHART_HIDDEN, loadChartHidden, loadSelfChartHidden,
    loadSelfTracked, loadTracked, saveChartHidden, saveSelfChartHidden, saveSelfTracked, saveTracked,
} from '@/lib/ccTracking';

// Shared, persisted CC tracking lists (kept in mogugi-config.toml [battle]; see settingsStorage).
export const trackedCCIds = ref<number[]>(loadTracked(settingsStorage));
export const chartHiddenCCIds = ref<Set<number>>(loadChartHidden(settingsStorage));

// Self-buff lanes: their own list, separate from the boss list.
export const selfTrackedCCIds = ref<number[]>(loadSelfTracked(settingsStorage));
export const selfChartHiddenCCIds = ref<Set<number>>(loadSelfChartHidden(settingsStorage));

export function setSelfTrackedCCIds(list: number[]) {
    selfTrackedCCIds.value = list;
    saveSelfTracked(settingsStorage, list);
}

export function setSelfChartHiddenCCIds(hidden: Set<number>) {
    selfChartHiddenCCIds.value = hidden;
    saveSelfChartHidden(settingsStorage, hidden);
}

export function setTrackedCCIds(list: number[]) {
    trackedCCIds.value = list;
    saveTracked(settingsStorage, list);
}

export function setChartHiddenCCIds(hidden: Set<number>) {
    chartHiddenCCIds.value = hidden;
    saveChartHidden(settingsStorage, hidden);
}

// Back to the built-in tracked list and chart-hidden set.
export function resetCCTracking() {
    setTrackedCCIds([...DEFAULT_CC_LIST]);
    setChartHiddenCCIds(new Set(DEFAULT_CHART_HIDDEN));
    setSelfTrackedCCIds([...DEFAULT_SELF_CC_LIST]);
    setSelfChartHiddenCCIds(new Set(DEFAULT_SELF_CHART_HIDDEN));
}

import type { Component } from 'vue';
import type { ChartKind } from '@/lib/chartProtocol';
import ConditionView from './views/ConditionView.vue';
import HitLogView from './views/HitLogView.vue';

/**
 * View contract: props `spec`, `data` (ChartData | null), `opts`, `range` (main-window filter; null = reset zoom); emits
 * `opts` (Partial<ChartOpts>) and `range` ({min,max} seconds | null).
 */
export const CHART_VIEWS: Partial<Record<ChartKind, Component>> = {
    condition: ConditionView,
    hitlog: HitLogView,
};

export function registerChartView(kind: ChartKind, view: Component): void {
    CHART_VIEWS[kind] = view;
}

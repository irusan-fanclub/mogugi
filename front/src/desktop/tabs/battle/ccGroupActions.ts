import { ref } from 'vue';
import { reorder } from '@/lib/ccTracking';
import type { MenuItem } from '../../ui/useContextMenu';
import {
    chartHiddenCCIds, selfChartHiddenCCIds, selfTrackedCCIds, setChartHiddenCCIds, setSelfChartHiddenCCIds,
    setSelfTrackedCCIds, setTrackedCCIds, trackedCCIds,
} from './ccSettings';

export type CcGroupKind = 'boss' | 'self';

// A group's tracked CCs: hidden ones count toward coverage but get no timeline lane.
export interface CcGroupState {
    tracked: number[];
    hidden: Set<number>;
    setTracked: (list: number[]) => void;
    setHidden: (hidden: Set<number>) => void;
}

export function ccGroupOf(kind: CcGroupKind): CcGroupState {
    return kind === 'boss'
        ? { tracked: trackedCCIds.value, hidden: chartHiddenCCIds.value, setTracked: setTrackedCCIds, setHidden: setChartHiddenCCIds }
        : { tracked: selfTrackedCCIds.value, hidden: selfChartHiddenCCIds.value, setTracked: setSelfTrackedCCIds, setHidden: setSelfChartHiddenCCIds };
}

export function setCcHidden(g: CcGroupState, id: number, hidden: boolean) {
    const next = new Set(g.hidden);
    if (hidden) next.add(id); else next.delete(id);
    g.setHidden(next);
}

export function removeCc(g: CcGroupState, id: number) {
    g.setTracked(g.tracked.filter(x => x !== id));
}

/** Track id on the timeline (chart) or for coverage only. */
export function trackCc(g: CcGroupState, id: number, chart: boolean) {
    if (!g.tracked.includes(id)) g.setTracked([...g.tracked, id]);
    if (g.hidden.has(id) === chart) setCcHidden(g, id, !chart);
}

/** Move id to target's place in the tracked list. */
export function moveCc(g: CcGroupState, id: number, target: number) {
    const from = g.tracked.indexOf(id);
    const to = g.tracked.indexOf(target);
    if (from >= 0 && to >= 0) g.setTracked(reorder(g.tracked, from, to));
}

// The CC's three states; the current one is shown disabled.
export function ccMenuItems(g: CcGroupState, id: number): MenuItem[] {
    const on = g.tracked.includes(id);
    const charted = on && !g.hidden.has(id);
    return [
        { label: '時間軸與覆蓋率', icon: 'mdi-chart-timeline-variant', disabled: charted, action: () => trackCc(g, id, true) },
        { label: '僅覆蓋率', icon: 'mdi-percent-outline', disabled: on && !charted, action: () => trackCc(g, id, false) },
        'divider',
        { label: '移除', icon: 'mdi-close', danger: true, disabled: !on, action: () => removeCc(g, id) },
    ];
}

// A CC icon being dragged on the chart or the coverage strip; it drops only onto
// its own group and kind (timeline or coverage only).
export const ccDrag = ref<{ group: CcGroupKind; id: number; hidden: boolean } | null>(null);

// `${group}:${id}` of the icon a drag is hovering, for its drop highlight.
export const ccDropKey = ref<string | null>(null);

export function canDropCc(group: CcGroupKind, hidden: boolean, id: number): boolean {
    const d = ccDrag.value;
    return d !== null && d.group === group && d.hidden === hidden && d.id !== id;
}

// v-on handlers for one icon; the move happens on drop, so lanes do not jump under the pointer.
export function ccIconDnd(group: CcGroupKind, id: number, hidden: boolean) {
    const key = `${group}:${id}`;
    return {
        dragstart(e: DragEvent) {
            ccDrag.value = { group, id, hidden };
            if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(id));
            }
        },
        dragover(e: DragEvent) {
            if (!canDropCc(group, hidden, id)) return;
            e.preventDefault();
            ccDropKey.value = key;
        },
        dragleave() {
            if (ccDropKey.value === key) ccDropKey.value = null;
        },
        drop(e: DragEvent) {
            const d = ccDrag.value;
            if (!d || !canDropCc(group, hidden, id)) return;
            e.preventDefault();
            moveCc(ccGroupOf(group), d.id, id);
            ccDrag.value = null;
            ccDropKey.value = null;
        },
        dragend() {
            ccDrag.value = null;
            ccDropKey.value = null;
        },
    };
}

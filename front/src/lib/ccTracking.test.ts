import { describe, it, expect } from 'vitest';
import {
    DEFAULT_CC_LIST, DEFAULT_CHART_HIDDEN, loadTracked, saveTracked,
    loadChartHidden, saveChartHidden, reorder, reorderWithin, availableCCs, seenCCIds,
    DEFAULT_SELF_CC_LIST, loadSelfTracked, saveSelfTracked, loadSelfChartHidden, saveSelfChartHidden,
} from './ccTracking';

const mem = (init: Record<string, string> = {}) => {
    const m = { ...init };
    return {
        getItem: (k: string) => (k in m ? m[k] : null),
        setItem: (k: string, v: string) => { m[k] = v; },
        raw: m,
    } as unknown as Storage & { raw: Record<string, string> };
};

describe('constants', () => {
    it('defaults exclude 無敵 494 and the self buffs', () => {
        expect(DEFAULT_CC_LIST).not.toContain(494);
        expect(DEFAULT_CC_LIST[0]).toBe(803);
        expect(DEFAULT_CC_LIST).not.toContain(516);
        expect(DEFAULT_CC_LIST).not.toContain(900206);
        expect(DEFAULT_CHART_HIDDEN).toEqual([1164, 1165, 1166, 1093, 392, 912, 598, 1138]);
    });
});

describe('loadTracked / saveTracked', () => {
    it('returns defaults when empty or corrupt', () => {
        expect(loadTracked(mem())).toEqual(DEFAULT_CC_LIST);
        expect(loadTracked(mem({ trackedDebuffCCIds: '{bad' }))).toEqual(DEFAULT_CC_LIST);
    });
    it('returns the stored list untouched (nothing is pinned)', () => {
        expect(loadTracked(mem({ trackedDebuffCCIds: '[5,494,6]' }))).toEqual([5, 494, 6]);
        expect(loadTracked(mem({ trackedDebuffCCIds: '[5]' }))).toEqual([5]);
    });
    it('saves under the old key', () => {
        const s = mem();
        saveTracked(s, [494, 1]);
        expect(s.raw.trackedDebuffCCIds).toBe('[494,1]');
    });
});

describe('loadChartHidden / saveChartHidden', () => {
    it('defaults and round trip under the old key', () => {
        expect([...loadChartHidden(mem())]).toEqual(DEFAULT_CHART_HIDDEN);
        const s = mem();
        saveChartHidden(s, new Set([3, 4]));
        expect(s.raw.chartHiddenCCIds).toBe('[3,4]');
        expect([...loadChartHidden(s)]).toEqual([3, 4]);
    });
});

describe('reorder', () => {
    const l = [494, 1, 2, 3];
    it('moves within the list', () => {
        expect(reorder(l, 3, 1)).toEqual([494, 3, 1, 2]);
    });
    it('treats 494 like any other item', () => {
        expect(reorder(l, 2, 0)).toEqual([2, 494, 1, 3]);
        expect(reorder(l, 0, 2)).toEqual([1, 2, 494, 3]);
        expect(reorder(l, 1, 1)).toEqual(l);
    });
    it('does not mutate the input', () => {
        const c = [...l]; reorder(c, 3, 1); expect(c).toEqual(l);
    });
});

describe('reorderWithin', () => {
    const odd = (id: number) => id % 2 === 1;
    it('moves among the members only, leaving the others in place', () => {
        expect(reorderWithin([1, 2, 3, 4, 5], odd, 2, 0)).toEqual([5, 2, 1, 4, 3]);
        expect(reorderWithin([1, 2, 3, 4, 5], odd, 0, 1)).toEqual([3, 2, 1, 4, 5]);
    });
    it('is a copy when nothing moves', () => {
        const list = [1, 2, 3];
        const out = reorderWithin(list, odd, 1, 1);
        expect(out).toEqual(list);
        expect(out).not.toBe(list);
    });
});

describe('availableCCs', () => {
    const base = { tracked: [494], targetCCIds: [7, 8], catalogue: null as number[] | null, search: '', nameOf: (id: number) => `cc${id}` };
    it('seen-only: target ids plus untracked defaults, sorted', () => {
        const r = availableCCs(base);
        expect(r.list).toEqual([...new Set([7, 8, ...DEFAULT_CC_LIST.filter(i => i !== 494)])].sort((a, b) => a - b));
        expect(r.overflow).toBe(0);
    });
    it('excludes tracked ids', () => {
        expect(availableCCs({ ...base, tracked: [494, 7] }).list).not.toContain(7);
    });
    it('searches by name or id, null-safe', () => {
        expect(availableCCs({ ...base, search: 'CC7' }).list).toEqual([7]);
        expect(availableCCs({ ...base, search: '80' }).list).toContain(803);
        expect(availableCCs({ ...base, search: null as never }).list.length).toBeGreaterThan(2);
    });
    it('caps at 300 and reports overflow', () => {
        const catalogue = Array.from({ length: 400 }, (_, i) => 100000 + i);
        const r = availableCCs({ ...base, catalogue });
        expect(r.list).toHaveLength(300);
        expect(r.overflow).toBe(400 + 2 + DEFAULT_CC_LIST.length - 300);
    });
});

describe('seenCCIds', () => {
    it('collects ids from history', () => {
        expect([...seenCCIds([{ List: [{ CCId: 1 }, { CCId: 2 }] }, { List: [{ CCId: 1 }] }])].sort()).toEqual([1, 2]);
    });
});

describe('generalised helpers', () => {
    it('reorder honours pinnedCount', () => {
        expect(reorder([1, 2, 3], 0, 2, 0)).toEqual([2, 3, 1]);
        expect(reorder([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
        expect(reorder([1, 2, 3], 0, 2, 1)).toEqual([1, 2, 3]);
        expect(reorder([1, 2, 3, 4], 1, 3, 2)).toEqual([1, 2, 3, 4]);
        expect(reorder([1, 2, 3, 4], 2, 3, 2)).toEqual([1, 2, 4, 3]);
    });
    it('availableCCs offers custom defaults instead of DEFAULT_CC_LIST', () => {
        const r = availableCCs({
            tracked: [], targetCCIds: [], catalogue: null, search: null, nameOf: () => undefined, defaults: [7],
        });
        expect(r.list).toEqual([7]);
    });
});

describe('self list', () => {
    it('defaults load when storage is empty or corrupt', () => {
        const self = [900206, 516, 476, 1225, 577, 680, 406, 407, 408, 511, 1037, 1123];
        expect(DEFAULT_SELF_CC_LIST).toEqual(self);
        expect(loadSelfTracked(mem())).toEqual(self);
        expect(loadSelfTracked(mem({ trackedSelfCCIds: '{bad' }))).toEqual(self);
        expect([...loadSelfChartHidden(mem())]).toEqual([680, 406, 407, 408, 511, 1225]);
        expect([...loadSelfChartHidden(mem({ chartHiddenSelfCCIds: '{bad' }))]).toEqual([680, 406, 407, 408, 511, 1225]);
    });
    it('round-trips under its own keys without pinned/party injection', () => {
        const s = mem();
        saveSelfTracked(s, [7, 8]);
        saveSelfChartHidden(s, new Set([8]));
        expect(s.raw.trackedSelfCCIds).toBe('[7,8]');
        expect(s.raw.chartHiddenSelfCCIds).toBe('[8]');
        expect(loadSelfTracked(s)).toEqual([7, 8]);
        expect([...loadSelfChartHidden(s)]).toEqual([8]);
    });
});

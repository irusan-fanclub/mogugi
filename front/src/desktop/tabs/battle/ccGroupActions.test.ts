// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { ccDrag, canDropCc, ccMenuItems, moveCc, trackCc, type CcGroupState } from './ccGroupActions';

function state(tracked: number[], hidden: number[]): CcGroupState {
    const g: CcGroupState = {
        tracked, hidden: new Set(hidden),
        setTracked: l => { g.tracked = l; },
        setHidden: h => { g.hidden = h; },
    };
    return g;
}
const labels = (g: CcGroupState, id: number) => ccMenuItems(g, id)
    .flatMap(m => (m === 'divider' ? [] : [m.label + (m.disabled ? '×' : '')]));
function act(g: CcGroupState, id: number, label: string) {
    for (const m of ccMenuItems(g, id)) if (m !== 'divider' && m.label === label) m.action();
}

describe('ccGroupActions', () => {
    it('menu enables only what applies to a timeline, coverage-only or untracked CC', () => {
        const g = state([1, 2], [2]);
        expect(labels(g, 1)).toEqual(['時間軸與覆蓋率×', '僅覆蓋率', '移除']);
        expect(labels(g, 2)).toEqual(['時間軸與覆蓋率', '僅覆蓋率×', '移除']);
        expect(labels(g, 3)).toEqual(['時間軸與覆蓋率', '僅覆蓋率', '移除×']);
    });
    it('menu actions move a CC between timeline, coverage only and untracked', () => {
        const g = state([1, 2], [2]);
        act(g, 1, '僅覆蓋率');
        expect([...g.hidden]).toEqual([2, 1]);
        act(g, 2, '時間軸與覆蓋率');
        expect([...g.hidden]).toEqual([1]);
        act(g, 1, '移除');
        expect(g.tracked).toEqual([2]);
        trackCc(g, 9, false);
        expect(g.tracked).toEqual([2, 9]);
        expect(g.hidden.has(9)).toBe(true);
    });
    it('moveCc puts the CC at the target place: before it going up, after it going down', () => {
        const g = state([1, 2, 3, 4], []);
        moveCc(g, 4, 2);
        expect(g.tracked).toEqual([1, 4, 2, 3]);
        moveCc(g, 1, 2);
        expect(g.tracked).toEqual([4, 2, 1, 3]);
        moveCc(g, 7, 2);
        expect(g.tracked).toEqual([4, 2, 1, 3]);
    });
    it('drops only within the same group and kind', () => {
        ccDrag.value = { group: 'boss', id: 1, hidden: false };
        expect(canDropCc('boss', false, 2)).toBe(true);
        expect(canDropCc('boss', false, 1)).toBe(false);
        expect(canDropCc('boss', true, 2)).toBe(false);
        expect(canDropCc('self', false, 2)).toBe(false);
        ccDrag.value = null;
        expect(canDropCc('boss', false, 2)).toBe(false);
    });
});

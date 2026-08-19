import { describe, it, expect } from 'vitest';
import { conditionStateChanged, SIGNIFICANT_PARAM_KEYS } from './conditionChange';
import type { EntityCondition } from '@/eventActor';

const cc = (CCId: number, Params: Record<string, string> = {}): EntityCondition =>
    ({ Id: '1', At: 0, CCId, DisableAt: 0, AttackerId: '', Params });

describe('conditionStateChanged', () => {
    it('reports no change when the same conditions carry the same values', () => {
        const a = [cc(192, { LSMA: '12' }), cc(680, { MCMBAMIN: '32.8' })];
        const b = [cc(192, { LSMA: '12' }), cc(680, { MCMBAMIN: '32.8' })];
        expect(conditionStateChanged(a, b)).toBe(false);
    });

    it('reports a change when a condition is added', () => {
        expect(conditionStateChanged([cc(680)], [cc(516), cc(680)])).toBe(true);
    });

    it('reports a change when a condition is replaced by another', () => {
        expect(conditionStateChanged([cc(680)], [cc(192)])).toBe(true);
    });

    // The bard re-buffs at a new magnitude: same CC, new number. Without this
    // the indicator keeps showing the old value for the rest of the fight.
    it('reports a change when a tracked CC re-enables at a new magnitude', () => {
        expect(conditionStateChanged(
            [cc(680, { MCMBAMIN: '28.4', SBT: '1000' })],
            [cc(680, { MCMBAMIN: '32.8', SBT: '1000' })],
        )).toBe(true);
    });

    // SBT/MCAGT are Mabi-time stamps that move on every refresh; pushing on
    // them would fill the history with entries that mean nothing.
    it('ignores a timestamp-only refresh', () => {
        expect(conditionStateChanged(
            [cc(680, { MCMBAMIN: '32.8', SBT: '1000', MCAGT: '10' })],
            [cc(680, { MCMBAMIN: '32.8', SBT: '2000', MCAGT: '20' })],
        )).toBe(false);
    });

    it('reports a change on every value-bearing key of each tracked CC', () => {
        for (const [id, keys] of Object.entries(SIGNIFICANT_PARAM_KEYS)) {
            for (const key of keys) {
                const before = [cc(+id, { [key]: '1' })];
                const after = [cc(+id, { [key]: '2' })];
                expect(conditionStateChanged(before, after), `${id}/${key}`).toBe(true);
            }
        }
    });

    it('reports a change when a tracked key appears or disappears', () => {
        expect(conditionStateChanged([cc(516, {})], [cc(516, { SOP_CRITICAL: '15' })])).toBe(true);
        expect(conditionStateChanged([cc(516, { SOP_CRITICAL: '15' })], [cc(516, {})])).toBe(true);
    });

    // Any CC may carry a counter that ticks on refresh; only the CCs the UI
    // reads magnitudes from may push a history entry on a value change.
    it('ignores value changes on an untracked CC', () => {
        expect(conditionStateChanged(
            [cc(494, { STACK: '1' })],
            [cc(494, { STACK: '2' })],
        )).toBe(false);
    });

    it('reports no change for two empty lists', () => {
        expect(conditionStateChanged([], [])).toBe(false);
    });
});

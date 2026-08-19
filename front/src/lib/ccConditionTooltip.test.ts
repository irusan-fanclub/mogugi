import { describe, it, expect } from 'vitest';
import { CC_PARAMS_TOOLTIP, AWAKENING_CC_ID } from './ccConditionTooltip';

describe('CC_PARAMS_TOOLTIP[516] (覺醒)', () => {
    const format = CC_PARAMS_TOOLTIP[AWAKENING_CC_ID]!;

    it('renders both bonuses from the game\'s own wording', () => {
        expect(format({ SOP_DMG_MINMAX: '15', SOP_CRITICAL: '15' })).toBe('傷害 +15%、暴擊率 +15%');
    });

    it('ignores the SBT key entirely — it is a scheduled expiry, not a stat', () => {
        const text = format({ SOP_DMG_MINMAX: '15', SOP_CRITICAL: '15', SBT: '8:1755123456' });
        expect(text).toBe('傷害 +15%、暴擊率 +15%');
        expect(text).not.toMatch(/SBT/);
    });

    it('renders only the damage bonus when crit is missing', () => {
        expect(format({ SOP_DMG_MINMAX: '15' })).toBe('傷害 +15%');
    });

    it('renders only the crit bonus when damage is missing', () => {
        expect(format({ SOP_CRITICAL: '15' })).toBe('暴擊率 +15%');
    });

    it('returns null when neither key is present', () => {
        expect(format({})).toBeNull();
    });

    it('treats an unparseable value as absent rather than crashing', () => {
        expect(format({ SOP_DMG_MINMAX: 'not-a-number', SOP_CRITICAL: '15' })).toBe('暴擊率 +15%');
    });

    it('does not print raw key names anywhere in the output', () => {
        const text = format({ SOP_DMG_MINMAX: '15', SOP_CRITICAL: '15' })!;
        expect(text).not.toMatch(/SOP_/);
    });

    it('has no formatter registered for an unrelated CCId', () => {
        expect(CC_PARAMS_TOOLTIP[999]).toBeUndefined();
    });
});

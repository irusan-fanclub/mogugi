import type { EntityCondition } from '@/eventActor';

/**
 * The value-bearing param keys of each CC the UI reads magnitudes from.
 * Timestamp keys (SBT, MCAGT — both Mabi-time stamps) are deliberately absent:
 * they move on every refresh and mean no real change. Add a CC here only when
 * something actually displays its numbers.
 */
export const SIGNIFICANT_PARAM_KEYS: Record<number, readonly string[]> = {
    192: ['LSMA', 'MFCP', 'AFCP', 'LSFA'],   // 活潑板
    516: ['SOP_DMG_MINMAX', 'SOP_CRITICAL'], // 覺醒
    680: ['MCMBAMIN', 'MCMBAMAX', 'MCMBAC'], // 戰場的序曲
};

/**
 * Whether the condition list is a new state worth a history entry: the set of
 * CCs changed, or a tracked CC re-enabled at a different magnitude. Both lists
 * must be sorted by CCId, as the caller's already are.
 */
export function conditionStateChanged(prev: EntityCondition[], current: EntityCondition[]): boolean {
    if (prev.length !== current.length) return true;
    return prev.some((p, i) => p.CCId !== current[i].CCId || significantValuesChanged(p, current[i]));
}

/**
 * Whether two readings of the same CC differ in a value the UI shows. Exported
 * so a caller re-enabling one already-active CC can rule out a state change
 * from that CC alone, instead of building and sorting the whole active set.
 */
export function significantValuesChanged(a: EntityCondition, b: EntityCondition): boolean {
    const keys = SIGNIFICANT_PARAM_KEYS[a.CCId];
    if (!keys) return false;
    return keys.some(k => a.Params[k] !== b.Params[k]);
}

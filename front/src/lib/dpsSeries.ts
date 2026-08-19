export type DamagePoint = { At: number; Damage: number };

/**
 * Rolling damage sum over a window CENTRED on each plotted point.
 *
 * Centring is what makes the curve line up with the debuff lanes, which are
 * drawn at their exact event times: a window summed over [t, t+w) but plotted
 * at t puts a burst's peak up to a full window early.
 *
 * Returns [ms since origin, summed damage] pairs, one per stride second.
 */
export function rollingDamageSeries(
    damages: readonly DamagePoint[],
    origin: number,
    windowSec: number,
    strideSec = 1,
): [number, number][] {
    if (damages.length === 0 || windowSec <= 0) return [];

    const sorted = damages.map(d => ({ rel: d.At - origin, dmg: d.Damage }))
        .sort((a, b) => a.rel - b.rel);
    const maxRel = sorted[sorted.length - 1].rel;
    const half = windowSec / 2;

    // Both edges advance monotonically with the centre, so the two pointers
    // walk the array once rather than rescanning it per step.
    const out: [number, number][] = [];
    let lo = 0, hi = 0, sum = 0;
    for (let c = 0; c <= maxRel; c += strideSec) {
        while (hi < sorted.length && sorted[hi].rel < c + half) sum += sorted[hi++].dmg;
        while (lo < sorted.length && sorted[lo].rel < c - half) sum -= sorted[lo++].dmg;
        out.push([c * 1000, sum]);
    }
    return out;
}

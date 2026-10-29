export interface HpMark { pct: number; at: number }   // at = absolute seconds

interface HpInput {
    lifeHistory: { At: number; Life: number }[];
    damages: { At: number; Damage: number }[];
    maxLife: number; start: number; end: number;
    downAt?: number | null;
}

export type HpCurve = [at: number, pct: number][];
type Pt = HpCurve[number];

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

// Sampled life where present, else maxLife - dealt so far; a kill within the fight ends at 0%.
export function hpCurve(i: HpInput): HpCurve {
    if (!(i.maxLife > 0)) return [];
    const life = [...i.lifeHistory].sort((a, b) => a.At - b.At);
    const firstSample = life.length ? life[0].At : Infinity;
    const pts: Pt[] = [];
    let dealt = 0;
    if (i.start < firstSample) pts.push([i.start, 100]);
    for (const d of [...i.damages].sort((a, b) => a.At - b.At)) {
        dealt += d.Damage;
        if (d.At < firstSample && d.At <= i.end) pts.push([d.At, clampPct((i.maxLife - dealt) / i.maxLife * 100)]);
    }
    for (const s of life) pts.push([s.At, clampPct(s.Life / i.maxLife * 100)]);
    const d = i.downAt;
    if (d != null && d >= i.start && d <= i.end && pts.length > 0 && d >= pts[pts.length - 1][0]) pts.push([d, 0]);
    return pts;
}

/** First downward crossing of each 5% step, linearly interpolated in time. */
export function hpCrossings(pts: HpCurve): HpMark[] {
    const marks: HpMark[] = [];
    // Start below the first point so a fight that begins under 95% still reports later steps.
    let next = pts.length ? Math.min(95, Math.ceil(pts[0][1] / 5) * 5 - 5) : 0;
    for (let k = 1; k < pts.length && next >= 5; k++) {
        const [t0, p0] = pts[k - 1];
        const [t1, p1] = pts[k];
        while (next >= 5 && p0 > next && p1 <= next) {
            marks.push({ pct: next, at: t0 + (t1 - t0) * (p0 - next) / (p0 - p1) });
            next -= 5;
        }
        // A heal that never reached the next step must not skip it; only lower p1 advances.
        while (next >= 5 && p1 <= next) next -= 5;
    }
    return marks;
}

/** Boss HP % at an absolute time; null without life data. */
export function hpPctAt(pts: HpCurve, at: number): number | null {
    if (pts.length === 0) return null;
    if (at <= pts[0][0]) return pts[0][1];
    for (let k = 1; k < pts.length; k++) {
        if (at <= pts[k][0]) {
            const [t0, p0] = pts[k - 1];
            const [t1, p1] = pts[k];
            return t1 === t0 ? p1 : p0 + (p1 - p0) * (at - t0) / (t1 - t0);
        }
    }
    return pts[pts.length - 1][1];
}

const tier = (pct: number) => (pct % 25 === 0 ? 0 : pct % 10 === 0 ? 1 : 2);

/** Percentages whose label is drawn: 25s first, then 10s, then the rest, skipping crowded ones. */
export function placeRulerLabels(marks: { pct: number; x: number }[], minGapPx = 30): Set<number> {
    const placed: { pct: number; x: number }[] = [];
    const order = [...marks].sort((a, b) => tier(a.pct) - tier(b.pct) || a.x - b.x);
    for (const m of order) {
        if (placed.every(p => Math.abs(p.x - m.x) >= minGapPx)) placed.push(m);
    }
    return new Set(placed.map(p => p.pct));
}

import type { EntityConditionState } from '@/eventActor';
import { clipToWindow } from './conditionCoverage';
import { CC_MERGE_MAP } from './effectTimeline';
import { paramNumber } from './ccParamSpecs';

export interface CcValueSummary {
    /** Per key: the reading with the largest amount (|n|); non-numeric keys keep the latest. */
    values: Record<string, string>;
    coveragePct: number;
}

/** Coverage as shown in the battle tab; 100% drops the decimal so cells keep one width. */
export function fmtCoveragePct(pct: number): string {
    const s = pct.toFixed(1);
    return (s === '100.0' ? '100' : s) + '%';
}

interface Acc extends CcValueSummary { onSec: number }

const amount = (raw: string | undefined) => {
    const n = paramNumber(raw);
    return n === null ? null : Math.abs(n);
};

/** Every CC on the entity within [start, end], aliases folded into the canonical id. One pass. */
export function ccValueSummaries(history: EntityConditionState[], start: number, end: number): Map<number, CcValueSummary> {
    const accs = new Map<number, Acc>();
    if (end <= start) return accs;
    const states = clipToWindow(history, start, end);
    for (let i = 0; i < states.length; i++) {
        const seg = (i + 1 < states.length ? states[i + 1].At : end) - states[i].At;
        const on = new Set<number>();
        for (const c of states[i].List) {
            const id = CC_MERGE_MAP[c.CCId] ?? c.CCId;
            let a = accs.get(id);
            if (!a) {
                a = { values: {}, coveragePct: 0, onSec: 0 };
                accs.set(id, a);
            }
            on.add(id);
            absorb(a, c.Params ?? {});
        }
        for (const id of on) accs.get(id)!.onSec += seg;
    }
    const out = new Map<number, CcValueSummary>();
    for (const [id, a] of accs) {
        out.set(id, { values: a.values, coveragePct: 100 * a.onSec / (end - start) });
    }
    return out;
}

function absorb(a: Acc, p: Record<string, string>) {
    for (const k in p) {
        const n = amount(p[k]);
        const prev = a.values[k] === undefined ? undefined : amount(a.values[k]);
        // Numbers beat text; among text the latest wins.
        const take = prev === undefined || (n === null ? prev === null : prev === null || n > prev);
        if (take) a.values[k] = p[k];
    }
}

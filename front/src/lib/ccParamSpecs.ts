import { AWAKENING_CC_ID, CC_PARAMS_TOOLTIP } from './ccConditionTooltip';

// What each CC Params key means, for the battle tab's CC tooltips. Values are the
// flat keys (in force on the target); the …T…V keys are only the latest trigger's offer.

type Values = Record<string, string>;
interface ParamSpec {
    /** The keys this row reads; the first is the row's own value. */
    keys: string[];
    /** null: a known value key that is shown raw. */
    label: string | null;
    fmt?: (v: number, values: Values) => string;
}
export interface ParamRow { label: string | null; value: string; key: string }

const MINUS = '−';
const round2 = (n: number) => Math.round(n * 100) / 100;
const neg = (v: number) => `${MINUS}${Math.abs(v)}`;
const pct = (v: number) => `${v < 0 ? MINUS : '+'}${round2(Math.abs(v))}%`;
const plain = (v: number) => String(v);
const times = (v: number) => `×${v}`;
/** A Params value as a number; 'true'/'false' (1138 MCCSSE) read as 1/0. null when not numeric. */
export function paramNumber(raw: string | undefined): number | null {
    if (raw === 'true') return 1;
    if (raw === 'false') return 0;
    const n = Number(raw);
    return raw === undefined || raw.trim() === '' || !Number.isFinite(n) ? null : n;
}

const row = (key: string, label: string | null, fmt?: ParamSpec['fmt']): ParamSpec => ({ keys: [key], label, fmt });

/** Add a meaning here; one row per key, in display order. */
export const CC_PARAM_SPECS: Record<number, ParamSpec[]> = {
    1164: [row('MCDDDV', '防禦', neg), row('MCDDPV', '保護', neg)],
    1165: [row('MCDMDDV', '魔法防禦', neg), row('MCDMDPV', '魔法保護', neg)],
    1166: [row('MCDDMBPV', '所受傷害', pct)],
    1176: [
        { keys: ['MCSTCT', 'MCSTMAX'], label: '層數', fmt: (v, p) => {
            const n = Number.isNaN(v) ? '?' : plain(v);
            return p.MCSTMAX === undefined ? n : `${n}／${p.MCSTMAX}`;
        } },
        row('SBDD', '防禦・魔法防禦', neg), row('SBPD', '保護・魔法保護', neg),
    ],
    1138: [row('MCCSSC', '層數', plain), row('MCCSSCR', '所受傷害', pct), row('MCCSSE', '滿層', v => (v ? '是' : '否'))],
    464: [row('MCSTSC', '層數', plain)],
    323: [row('SDP', '增傷', v => pct(v - 100))],
    1122: [row('SEDSDR', '增傷倍率', v => `×${v.toFixed(2)}`)],
    1026: [row('ACCVV1', '物/魔防禦', neg), row('ACCVV2', '物/魔保護', neg)],
    1161: [row('MCWWMBD', '增傷', times), row('MCWWDMS', '緩速', plain)],
    10001: [row('MCLV', '魔法陣等級', plain)],
    10002: [row('MCLV', '魔法陣等級', plain)],
    577: [row('BF_DM', '技能傷害', pct)],
    511: [row('SSAD', null), row('SSCRI', null), row('SSRT', null), row('SDUR', '持續', v => `${v} 秒`)],
    [AWAKENING_CC_ID]: [{
        keys: ['SOP_DMG_MINMAX', 'SOP_CRITICAL'], label: '效果',
        fmt: (_, p) => CC_PARAMS_TOOLTIP[AWAKENING_CC_ID]!(p) ?? '',
    }],
};

/** Timestamps, trigger bookkeeping and the source skill; never shown. */
export const PLUMBING_KEYS: ReadonlySet<string> = new Set(['SBT', 'MCAGT', 'MCDCTROID', 'MCDCTSI', 'MCDCPASI', 'MCDCASI']);

/** Keys whose change is a new state for the condition history (see conditionChange). Not
 * MCDCASI: it moves on most refreshes; a value increase already brings its source along. */
export const CC_VALUE_KEYS: Record<number, readonly string[]> = Object.fromEntries(
    Object.entries(CC_PARAM_SPECS).map(([id, specs]) => [id, specs.flatMap(s => s.keys)]),
);

/** Known keys first in spec order, then the rest raw and sorted; plumbing hidden. */
export function ccParamRows(ccId: number, values: Values): ParamRow[] {
    const out: ParamRow[] = [];
    const used = new Set<string>();
    for (const s of CC_PARAM_SPECS[ccId] ?? []) {
        const present = s.keys.filter(k => values[k] !== undefined);
        if (present.length === 0) continue;
        s.keys.forEach(k => used.add(k));
        const raw = values[s.keys[0]];
        const n = paramNumber(raw);
        const value = s.fmt && (raw === undefined || n !== null) ? s.fmt(n ?? NaN, values) : raw ?? '';
        out.push(s.label === null ? { label: null, value, key: s.keys[0] } : { label: s.label, value, key: present.join('／') });
    }
    const rest = Object.keys(values).filter(k => !used.has(k) && !PLUMBING_KEYS.has(k)).sort();
    for (const k of rest) out.push({ label: null, value: values[k], key: k });
    return out;
}

// The 「破防保最高」 box: fixed 2×2, row by row.
export interface BoxItem { ccId: number; key: string; fmt: (v: number) => string }
export const BREAK_BOX: readonly BoxItem[] = [
    { ccId: 1164, key: 'MCDDPV', fmt: neg },
    { ccId: 1166, key: 'MCDDMBPV', fmt: pct },
    { ccId: 1165, key: 'MCDMDPV', fmt: neg },
    { ccId: 1176, key: 'SBPD', fmt: neg },
];

/** The item's value as text; 「0」 when the CC never carried it. */
export function boxValueText(item: BoxItem, values: Values | undefined): string {
    const n = paramNumber(values?.[item.key]);
    return n !== null && n !== 0 ? item.fmt(n) : '0';
}

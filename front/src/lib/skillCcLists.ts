import { CC_MERGE_MAP } from './effectTimeline';

// Skill-table CC coverage lists: 通用/秘法 x BOSS/自身, independent of the BOSS coverage list.
export interface CcPair { boss: number[]; self: number[] }
export interface SkillCcModel { common: CcPair; arcana: Record<number, CcPair> }

const MODEL_KEY = 'skillCcModel';

const DEFAULT_MODEL: SkillCcModel = {
    common: { boss: [1026, 803, 10001, 10002], self: [577, 516, 900206] },
    arcana: {
        1: { boss: [839, 323], self: [10020] },
        3: { boss: [], self: [938] },
        4: { boss: [], self: [10048] },
        6: { boss: [], self: [975] },
        7: { boss: [], self: [1122, 1123] },
        8: { boss: [], self: [1145, 1146] },
    },
};

function readJson(s: Storage, key: string): unknown {
    try {
        const raw = s.getItem(key);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return undefined;
}

const isNumList = (v: unknown): v is number[] => Array.isArray(v) && v.every(n => typeof n === 'number');
const isPair = (v: unknown): v is CcPair =>
    !!v && typeof v === 'object' && isNumList((v as CcPair).boss) && isNumList((v as CcPair).self);
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function defaultSkillCcModel(): SkillCcModel {
    return parseModel(DEFAULT_MODEL)!;
}

function parseModel(v: unknown): SkillCcModel | null {
    if (!isRecord(v) || !isPair(v.common) || !isRecord(v.arcana)) return null;
    const arcana: Record<number, CcPair> = {};
    for (const [k, p] of Object.entries(v.arcana)) {
        if (!isPair(p)) return null;
        arcana[Number(k)] = { boss: [...p.boss], self: [...p.self] };
    }
    return { common: { boss: [...v.common.boss], self: [...v.common.self] }, arcana };
}

/** Absent or malformed key: the defaults. */
export function loadSkillCcModel(s: Storage): SkillCcModel {
    return parseModel(readJson(s, MODEL_KEY)) ?? defaultSkillCcModel();
}

export function saveSkillCcModel(s: Storage, m: SkillCcModel): void {
    s.setItem(MODEL_KEY, JSON.stringify(m));
}

/** Common first, then the arcana's lists, deduped by canonical CC id (first occurrence kept). */
export function effectiveSkillCcs(m: SkillCcModel, arcana: number | null): CcPair {
    const a = arcana ? m.arcana[arcana] : undefined;
    const merge = (x: number[], y: number[]) => {
        const seen = new Set<number>();
        return [...x, ...y].filter(id => {
            const c = CC_MERGE_MAP[id] ?? id;
            if (seen.has(c)) return false;
            seen.add(c);
            return true;
        });
    };
    return { boss: merge(m.common.boss, a?.boss ?? []), self: merge(m.common.self, a?.self ?? []) };
}

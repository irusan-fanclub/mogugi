import { describe, it, expect } from 'vitest';
import { effectiveSkillCcs, loadSkillCcModel, saveSkillCcModel } from './skillCcLists';

const mem = (init: Record<string, string> = {}) => {
    const m = new Map<string, string>(Object.entries(init));
    return {
        m,
        getItem: (k: string) => m.get(k) ?? null,
        setItem: (k: string, v: string) => { m.set(k, v); },
        removeItem: (k: string) => { m.delete(k); },
    } as unknown as Storage & { m: Map<string, string> };
};

describe('skillCcLists v2', () => {
    it('defaults', () => {
        const m = loadSkillCcModel(mem());
        expect(m.common).toEqual({ boss: [1026, 803, 10001, 10002], self: [577, 516, 900206] });
        expect(m.arcana[1]).toEqual({ boss: [839, 323], self: [10020] });
        expect(m.arcana[7]).toEqual({ boss: [], self: [1122, 1123] });
        expect(Object.keys(m.arcana).map(Number)).toEqual([1, 3, 4, 6, 7, 8]);
    });
    it('round-trips', () => {
        const s = mem();
        const m = loadSkillCcModel(s);
        m.common.boss = [1];
        saveSkillCcModel(s, m);
        expect(loadSkillCcModel(s).common.boss).toEqual([1]);
    });
    it('malformed falls back to defaults', () => {
        const m = loadSkillCcModel(mem({ skillCcModel: '{bad' }));
        expect(m.common.self).toEqual([577, 516, 900206]);
        expect(loadSkillCcModel(mem({ skillCcModel: '{"common":1}' })).common.boss).toEqual([1026, 803, 10001, 10002]);
    });
    it('merge dedupe by canonical id', () => {
        const m = loadSkillCcModel(mem());
        m.common.boss = [912];
        m.arcana[1].boss = [913, 5];
        expect(effectiveSkillCcs(m, 1).boss).toEqual([912, 5]);
        expect(effectiveSkillCcs(m, 1).self).toEqual([577, 516, 900206, 10020]);
    });
    it('unknown arcana yields common only', () => {
        const m = loadSkillCcModel(mem());
        expect(effectiveSkillCcs(m, 99)).toEqual(m.common);
        expect(effectiveSkillCcs(m, null)).toEqual(m.common);
    });
});

import { describe, it, expect } from 'vitest';
import {
    arcanaLevelOf, buildCharacterInfo, combatTalentsFor, raceOf, type CharacterInfoInput,
} from './characterInfo';
import type { ownerPanel, ownerProfile } from '@/protocols';

const panel = (over: Partial<ownerPanel> = {}) =>
    ({ level: 200, cumulatedLevel: 49460, charType: 8002, ...over }) as ownerPanel;

// Nine classes at Lv.50 (exp 55441+), the 10 being 狂怒鬥士, like the giant capture.
const classes = (ids: number[], exp = 55455) => ids.map(classId => ({ classId, exp, arcanaLevel: 0 }));
const GIANT_CLASSES = [1, 2, 3, 5, 6, 7, 8, 9, 10];

// Owns the grandmaster title of talent t (10016 + 100 t; 23 is 12232).
const gmTitle = (t: number) => (t === 23 ? 12232 : 10016 + 100 * t);
const GIANT_TALENTS = [1, 2, 5, 6, 7, 8, 9, 10, 17, 18, 19];

const profile = (over: Partial<ownerProfile> = {}): ownerProfile => ({
    titles: { titleId: 10700, optionTitleId: 9180 },
    talent: { grandmasterTalentId: 10, ownedTitleIds: GIANT_TALENTS.map(gmTitle) },
    multiClass: { currentClassId: 10, classes: classes(GIANT_CLASSES).map(c => ({ ...c, arcanaLevel: c.classId === 10 ? 10 : 0 })) },
    ...over,
});

const input = (over: Partial<CharacterInfoInput> = {}): CharacterInfoInput =>
    ({ name: '地獄哞菇', panel: panel(), profile: profile(), ...over });
const rows = (i: CharacterInfoInput) => buildCharacterInfo(i)!;
const row = (i: CharacterInfoInput, label: string) => rows(i).find(r => r.label === label)!;

describe('raceOf', () => {
    it('maps the Race.xml player ids', () => {
        for (const id of [8000, 8001, 8002]) expect(raceOf(id)).toBe('giant');
        for (const id of [9000, 9001, 9002]) expect(raceOf(id)).toBe('elf');
        for (const id of [10000, 10001, 10002]) expect(raceOf(id)).toBe('human');
        expect(raceOf(0)).toBeNull();
        expect(raceOf(990104)).toBeNull();
    });
});

describe('arcanaLevelOf', () => {
    it('converts exp to a level 1..50 with the table thresholds', () => {
        expect(arcanaLevelOf(0)).toBe(1);
        expect(arcanaLevelOf(599)).toBe(1);
        expect(arcanaLevelOf(600)).toBe(2);
        expect(arcanaLevelOf(26865)).toBe(34);
        expect(arcanaLevelOf(55440)).toBe(49);
        expect(arcanaLevelOf(55441)).toBe(50);
        expect(arcanaLevelOf(99999)).toBe(50);
    });
});

describe('combatTalentsFor', () => {
    it('counts 12 / 11 / 11 and drops the bow for giants and the lance for elves', () => {
        expect(combatTalentsFor('human')).toHaveLength(12);
        expect(combatTalentsFor('elf').map(t => t.name)).not.toContain('騎槍');
        expect(combatTalentsFor('elf')).toHaveLength(11);
        expect(combatTalentsFor('giant').map(t => t.name)).not.toContain('弓術');
        expect(combatTalentsFor('giant')).toHaveLength(11);
    });
});

describe('buildCharacterInfo', () => {
    it('returns null before any snapshot arrives', () => {
        expect(buildCharacterInfo({ name: '', panel: null, profile: null })).toBeNull();
    });
    it('lists the twelve fields in the agreed order', () => {
        expect(rows(input()).map(r => r.label)).toEqual([
            '角色名稱', '種族', '稱號', '第二稱號', '當前秘法', '當前一代宗師',
            '秘法等級', '秘法同步等級', '當前等級', '累積等級', '秘法綜合等級', '一代宗師戰鬥才能',
        ]);
    });
    it('formats the capture values and colours capped ones', () => {
        const i = input();
        expect(row(i, '角色名稱')).toMatchObject({ value: '地獄哞菇', state: 'plain' });
        expect(row(i, '種族').value).toBe('巨人');
        expect(row(i, '稱號').value).toBe('戰場的序曲大師');
        expect(row(i, '第二稱號').value).toBe('歐哈德');
        expect(row(i, '當前秘法').value).toBe('狂怒鬥士');
        expect(row(i, '當前一代宗師').value).toBe('祝福');
        expect(row(i, '秘法等級')).toMatchObject({ value: '50/50', state: 'ok' });
        expect(row(i, '秘法同步等級')).toMatchObject({ value: '10/10', state: 'ok' });
        expect(row(i, '當前等級')).toMatchObject({ value: '200/200', state: 'ok' });
        expect(row(i, '累積等級')).toMatchObject({ value: '49,660/40,000', state: 'ok' });
        expect(row(i, '秘法綜合等級')).toMatchObject({ value: '450/450', state: 'ok' });
    });
    it('marks short values orange and keeps the cap in the text', () => {
        const i = input({
            panel: panel({ level: 150, cumulatedLevel: 100 }),
            profile: profile({ multiClass: { currentClassId: 1, classes: [{ classId: 1, exp: 26865, arcanaLevel: 4 }, ...classes([2, 3, 5, 6, 7, 8, 9, 10])] } }),
        });
        expect(row(i, '秘法等級')).toMatchObject({ value: '34/50', state: 'short' });
        expect(row(i, '秘法同步等級')).toMatchObject({ value: '4/10', state: 'short' });
        expect(row(i, '當前等級')).toMatchObject({ value: '150/200', state: 'short' });
        expect(row(i, '累積等級')).toMatchObject({ value: '250/40,000', state: 'short' });
        expect(row(i, '秘法綜合等級')).toMatchObject({ value: '434/450', state: 'short' });
    });
    it('scales the arcana total to the race (human 10 classes = 500)', () => {
        const i = input({
            panel: panel({ charType: 10002 }),
            profile: profile({ multiClass: { currentClassId: 10, classes: classes([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) } }),
        });
        expect(row(i, '秘法綜合等級')).toMatchObject({ value: '500/500', state: 'ok' });
    });
    it('shows 無 for no title / arcana / grandmaster and dashes for unreadable sections', () => {
        const i = input({ profile: profile({
            titles: { titleId: 0, optionTitleId: 0 },
            talent: { grandmasterTalentId: 255, ownedTitleIds: [] },
            multiClass: { currentClassId: 0, classes: [] },
        }) });
        expect(row(i, '稱號').value).toBe('無');
        expect(row(i, '當前一代宗師').value).toBe('無');
        expect(row(i, '當前秘法').value).toBe('無');
        expect(row(i, '秘法等級')).toMatchObject({ value: '—', state: 'plain' });
        expect(row(i, '秘法綜合等級')).toMatchObject({ value: '0/450', state: 'short' });

        const j = input({ panel: null, profile: profile({ titles: null, talent: null, multiClass: null }) });
        for (const l of ['種族', '稱號', '第二稱號', '當前秘法', '當前一代宗師', '秘法等級', '秘法同步等級', '當前等級', '累積等級', '秘法綜合等級', '一代宗師戰鬥才能']) {
            expect(row(j, l)).toMatchObject({ value: '—', state: 'plain' });
        }
    });
    it('falls back to the raw id for a title the tables do not know', () => {
        const i = input({ profile: profile({ titles: { titleId: 99999999, optionTitleId: 0 } }) });
        expect(row(i, '稱號').value).toBe('#99999999');
    });
    it('does not report a current class that is missing from the records', () => {
        const i = input({ profile: profile({ multiClass: { currentClassId: 4, classes: classes(GIANT_CLASSES) } }) });
        expect(row(i, '秘法等級').value).toBe('—');
    });
});

describe('一代宗師戰鬥才能', () => {
    it('is complete and hides the missing line when every learnable talent is mastered', () => {
        const r = row(input(), '一代宗師戰鬥才能');
        expect(r).toMatchObject({ value: '11/11', state: 'ok' });
        expect(r.missing).toBeUndefined();
    });
    it('lists the talents not mastered yet', () => {
        const owned = GIANT_TALENTS.filter(t => t !== 17 && t !== 2).map(gmTitle);
        const i = input({ profile: profile({ talent: { grandmasterTalentId: 10, ownedTitleIds: owned } }) });
        expect(row(i, '一代宗師戰鬥才能')).toMatchObject({ value: '9/11', state: 'short', missing: '魔法、雙槍' });
    });
    it('does not count the bow for a giant even if the title were owned', () => {
        const i = input({ profile: profile({ talent: { grandmasterTalentId: 10, ownedTitleIds: [...GIANT_TALENTS, 3].map(gmTitle) } }) });
        expect(row(i, '一代宗師戰鬥才能').value).toBe('11/11');
    });
    it('uses 12 for a human and needs the bow', () => {
        const i = input({ panel: panel({ charType: 10001 }) });
        expect(row(i, '一代宗師戰鬥才能')).toMatchObject({ value: '11/12', missing: '弓術' });
    });
    it('is a dash when the race is unknown', () => {
        expect(row(input({ panel: panel({ charType: 0 }) }), '一代宗師戰鬥才能').value).toBe('—');
    });
});

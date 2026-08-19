// arcanaTable.test.ts — hand-written skill-id -> arcana detection table.
import { describe, it, expect } from 'vitest';
import { ARCANA_BY_SKILL, ARCANA_NAMES } from './arcanaTable';

describe('arcanaTable', () => {
    it('names all ten arcana', () => {
        expect(Object.keys(ARCANA_NAMES)).toHaveLength(10);
        expect(ARCANA_NAMES[9]).toBe('旋律人偶師');
    });

    it('maps a skill from each arcana', () => {
        expect(ARCANA_BY_SKILL[59023]).toBe(1);
        expect(ARCANA_BY_SKILL[59000]).toBe(2);
        expect(ARCANA_BY_SKILL[59040]).toBe(3);
        expect(ARCANA_BY_SKILL[59060]).toBe(4);
        expect(ARCANA_BY_SKILL[59080]).toBe(5);
        expect(ARCANA_BY_SKILL[59100]).toBe(6);
        expect(ARCANA_BY_SKILL[59120]).toBe(7);
        expect(ARCANA_BY_SKILL[59140]).toBe(8);
        expect(ARCANA_BY_SKILL[59160]).toBe(9);
        expect(ARCANA_BY_SKILL[59180]).toBe(10);
    });

    it('excludes 59003 from the Bishop block', () => {
        expect(ARCANA_BY_SKILL[59002]).toBe(2);
        expect(ARCANA_BY_SKILL[59003]).toBeUndefined();
        expect(ARCANA_BY_SKILL[59004]).toBe(2);
    });

    // 59020-59022 are 注魔 enchant skills, not arcana.
    it('excludes the enchant block', () => {
        for (const id of [59020, 59021, 59022]) {
            expect(ARCANA_BY_SKILL[id]).toBeUndefined();
        }
    });

    // Detection ids, not each arcana's own skill count — the puppeteer's
    // three summon skills identify it without belonging to its skill list.
    it('maps the expected number of ids per arcana', () => {
        const counts: Record<number, number> = {
            1: 6, 2: 8, 3: 7, 4: 6, 5: 7, 6: 7, 7: 7, 8: 6, 9: 10, 10: 9,
        };
        for (const [arcana, want] of Object.entries(counts)) {
            const got = Object.values(ARCANA_BY_SKILL).filter(v => v === +arcana).length;
            expect(got, `arcana ${arcana}`).toBe(want);
        }
    });

    // Puppet-summon skills: only a puppeteer uses them, so they identify
    // arcana 9 even though its own skill list stops at 59166.
    it('maps the puppet-summon skills to the puppeteer', () => {
        for (const id of [59167, 59168, 59169]) {
            expect(ARCANA_BY_SKILL[id], `skill ${id}`).toBe(9);
        }
    });

    // Single assertion that catches any fat-fingered range boundary
    // anywhere in the table, unlike per-arcana spot checks above.
    it('has exactly 73 detection skill ids in total', () => {
        expect(Object.keys(ARCANA_BY_SKILL)).toHaveLength(73);
    });
});

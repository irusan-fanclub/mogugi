// gen-skill-tags.test.mjs — pure-function test for the skill-tag generator.
import { describe, it, expect } from 'vitest';
import { parseNoTuairimReset } from './gen-skill-tags.mjs';

describe('parseNoTuairimReset', () => {
    it('returns only tagged skills, deduplicated and sorted', () => {
        const xml = `<Skill SkillID="59086" SkillEngName="A" StringID="/singleattack/no_cooltime_reset_by_tuairim/" />
<Skill SkillID="100" SkillEngName="B" StringID="/singleattack/" />
<Skill SkillID="27210" StringID="/no_cooltime_reset_by_tuairim/" UseQuickOption="True" />
<Skill SkillID="59086" StringID="/no_cooltime_reset_by_tuairim/" />`;
        expect(parseNoTuairimReset(xml)).toEqual([27210, 59086]);
    });
});

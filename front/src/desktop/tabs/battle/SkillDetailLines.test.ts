// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import SkillDetailLines from './SkillDetailLines.vue';

const lines = (covered: number, total: number) => [
    { key: 'cc', label: 'CC', sections: [{ key: 'boss', chips: [{ ccId: 10, covered, total }] }] },
];

describe('SkillDetailLines', () => {
    it('colours from the rounded one-decimal percentage', () => {
        const pct = mount(SkillDetailLines, { props: { lines: lines(198, 500) } }).get('.pct');
        expect(pct.text()).toBe('39.6%');
        expect(pct.classes()).toContain('warn');
        expect(pct.classes()).not.toContain('err');
    });

    it('renders an empty fixed slot when a skill has no value', () => {
        const w = mount(SkillDetailLines, { props: { lines: [
            { key: 'cc', label: 'CC', sections: [{ key: 'boss', chips: [{ ccId: 10, covered: 0, total: 0 }, { ccId: 11, covered: 1, total: 2 }] }] },
        ] } });
        const chips = w.findAll('.chip');
        expect(chips.map(c => c.attributes('data-cc'))).toEqual(['10', '11']);
        expect(chips[0].classes()).toContain('empty');
        expect(chips[0].text()).toBe('');
    });
});

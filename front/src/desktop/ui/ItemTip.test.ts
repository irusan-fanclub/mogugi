// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import ItemTip from './ItemTip.vue';
import src from './ItemTip.vue?raw';
import type { Tip } from '@/lib/itemTooltip';

const empty = (): Tip => ({
    props: [], imprint: null, enchants: [], bless: [], relic: [], relicDesc: null, magicCircle: [],
    upgrades: [], special: null, energy: null, metalware: [], colorGroups: [],
});
const sections = (w: ReturnType<typeof mount>) => w.findAll('.tip-section').map(s => s.text());

describe('ItemTip', () => {
    it('renders enchant and metalware sections', () => {
        const tip = { ...empty(),
            enchants: [{ slot: '接頭', name: '辛勤的', rank: 'A', desc: '生命 +10' }],
            metalware: [{ name: '強化', level: 3, max: 20, value: '1.5' }] };
        const w = mount(ItemTip, { props: { tip } });
        expect(sections(w)).toEqual(['魔力賦予', '細緻工匠']);
        expect(w.text()).toContain('辛勤的');
        expect(w.text()).toContain('強化 (3/20等級)');
        expect(w.text()).toContain('L 1.5');
    });
    it('renders every other section and the title', () => {
        const tip: Tip = { ...empty(), props: ['攻擊 1'], imprint: 'Lv 5', bless: ['b'], relic: ['r'], relicDesc: 'd',
            magicCircle: ['m'], upgrades: ['u'], special: 'R', energy: 'e', colorGroups: [{ label: '顏色', colors: ['ff0000', '00ff00'] }] };
        const w = mount(ItemTip, { props: { tip, title: '劍' } });
        expect(w.find('.tip-title').text()).toBe('劍');
        expect(sections(w)).toEqual(['等級', '道具屬性', '聖水效果', '遺物效果', '魔法陣效果', '改造', '聚能', '顏色']);
        expect(w.text()).toContain('部位 B');
        expect(w.text()).toContain('#FF0000');
    });
    it('omits empty sections', () => {
        expect(sections(mount(ItemTip, { props: { tip: empty() } }))).toEqual([]);
    });
    it('uses tokens, no hex colours in styles', () => {
        expect(src.split('<style')[1]).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    });
});

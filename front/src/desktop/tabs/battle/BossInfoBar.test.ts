// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import BossInfoBar from './BossInfoBar.vue';
import type { BossInfoVM } from '@/lib/bossInfo';

const info = (over: Partial<BossInfoVM> = {}): BossInfoVM => ({
    name: '米勒', hpPct: 15, life: 294591872, maxLife: 1967880064, dealt: 1717998152, dead: false, fightSec: 691, partyDps: 2490000, ...over,
});

describe('BossInfoBar', () => {
    it('shows the percent cell with the same class and width style for alive and dead', () => {
        const alive = mount(BossInfoBar, { props: { info: info() } }).find('[data-pct]');
        const dead = mount(BossInfoBar, { props: { info: info({ dead: true, hpPct: 0, life: 0 }) } }).find('[data-pct]');
        expect(alive.text()).toBe('15.0%');
        expect(dead.text()).toBe('x_x');
        expect(alive.classes()).toContain('pct');
        expect(dead.classes()).toContain('pct');
        expect(dead.classes()).toContain('dead');
        expect(alive.attributes('style') ?? '').toBe(dead.attributes('style') ?? '');
    });
    it('formats life, dealt, elapsed time and party dps', () => {
        const t = mount(BossInfoBar, { props: { info: info() } }).text();
        expect(t).toContain('294,591,872');
        expect(t).toContain('1,967,880,064');
        expect(t).toContain('已造成 1,717,998,152');
        expect(t).toContain('經過時間');
        expect(t).toContain('11:31');
        expect(t).toContain('隊伍 DPS');
        expect(t).toContain('2.49M');
    });
    it('shows 0:00 and no percent text without a fight or max life', () => {
        const w = mount(BossInfoBar, { props: { info: info({ fightSec: null, hpPct: null, maxLife: 0 }) } });
        expect(w.text()).toContain('0:00');
        expect(w.find('[data-pct]').text()).toBe('—');
    });
});

// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import PlayerRow from './PlayerRow.vue';
import type { PlayerVM } from './battleTypes';
import { humanReadableNumber } from '@/lib/util';

function vm(activeDps: number | null): PlayerVM {
    return {
        id: '1', realName: '甲', name: '甲', arcana: null, arcanaHidden: false,
        total: 1000, spanSec: 10, dps: 100, activeDps, activeSec: activeDps === null ? null : 10, share: 1,
        music: { kind: 'absent' }, hasCondition: false, damages: [], skillUses: [],
    };
}
const render = (v: PlayerVM) => mount(PlayerRow, {
    props: { vm: v, expanded: false, narrow: false, origin: 0, knownRealNames: [] },
});

describe('PlayerRow music jab', () => {
    it('a 聖詠者 blames the teammates for the gaps', () => {
        const runs = [{ pct: 70, range: [0, 10] }, { pct: 71, range: [20, 30] }, { pct: 72, range: [40, 50] }];
        const v = (arcana: number) => ({ ...vm(1), arcana, music: { kind: 'present', ccId: 1, isOn: true, songChanged: false, coverage: 0.5, runs } }) as PlayerVM;
        expect(render(v(2)).get('.music').attributes('title')).toContain('你隊友為什麼不續音樂');
        expect(render(v(1)).get('.music').attributes('title')).toContain('為什麼不續音樂、為什麼要死');
    });
});

describe('PlayerRow share bar', () => {
    it('fills in the chart line colour when given one', () => {
        const w = mount(PlayerRow, { props: { vm: vm(1), expanded: false, narrow: false, origin: 0, knownRealNames: [], seriesColor: 'rgb(1, 2, 3)' } });
        expect((w.get('.share-bar .fill').element as HTMLElement).style.background).toContain('rgb(1, 2, 3)');
    });
});

describe('PlayerRow expand affordance', () => {
    it('shows a right chevron when closed and a down chevron when open', () => {
        expect(render(vm(1)).get('[data-chev]').classes()).toContain('mdi-chevron-right');
        const open = mount(PlayerRow, { props: { vm: vm(1), expanded: true, narrow: false, origin: 0, knownRealNames: [] } });
        expect(open.get('[data-chev]').classes()).toContain('mdi-chevron-down');
    });

    it('explains the music value in its tooltip, even when not compact', () => {
        const v = vm(1);
        v.music = { kind: 'present', ccId: 1, isOn: true, songChanged: false, coverage: 0.5,
            runs: [{ pct: 93.9, range: [4, 95] }, { pct: 50, range: [100, 200] }] } as PlayerVM['music'];
        const w = render(v);
        expect(w.get('.music .value').text()).toBe('93.9% → 50.0%');
        const tip = w.get('.music').attributes('title')!;
        expect(tip).toContain('音樂增益，覆蓋 50.0%');
        expect(tip).toContain('93.9%　0:04~1:35');
        expect(tip).toContain('50.0%　1:40~3:20');
    });
});

describe('PlayerListHeader', () => {
    it('labels every numeric column in row order', async () => {
        const { default: PlayerListHeader } = await import('./PlayerListHeader.vue');
        const labels = mount(PlayerListHeader, { props: { narrow: false } }).findAll('.lbl').map(e => e.text());
        expect(labels).toEqual(['音樂', '時間', '總傷害', 'DPS', '活躍DPS', '佔比']);
    });
});

describe('PlayerRow active DPS', () => {
    it('renders the formatted value with the explanatory title', () => {
        const el = render(vm(1234.5)).get('[data-active-dps]');
        expect(el.text()).toBe(humanReadableNumber(1234.5));
        expect(el.attributes('title')).toBe('活躍 DPS：排除開場 5 秒、BOSS 無敵與死亡');
    });

    it('renders - for null', () => {
        expect(render(vm(null)).get('[data-active-dps]').text()).toBe('-');
    });
});

describe('PlayerRow joined share bar', () => {
    it('row and bar share one block: no gap, row bottom square, bar top square', () => {
        const w = render(vm(1));
        expect(w.get('.player-row').classes()).toContain('joined');
        expect(w.get('.share-bar').classes()).toContain('joined');
        expect(w.get('.share-bar').classes()).not.toContain('open');
    });
    it('squares the bar bottom when expanded so the skill table joins it', () => {
        const w = mount(PlayerRow, { props: { vm: vm(1), expanded: true, narrow: false, origin: 0, knownRealNames: [] } });
        expect(w.get('.share-bar').classes()).toContain('open');
    });
});

describe('PlayerRow name width', () => {
    it('reserves 7em for the name so the buttons line up', () => {
        const n = render(vm(1)).get('.pname').element as HTMLElement;
        expect(n.style.width).toBe('7em');
        expect([n.style.flexGrow, n.style.flexShrink]).toEqual(['0', '0']);
    });
});

describe('PlayerRow buttons', () => {
    it('sizes the timeline button like the edit/dice buttons', async () => {
        const w = render(vm(1));
        expect(w.find('.btns .d-icon-btn').exists()).toBe(true);
        const src = (await import('./PlayerRow.vue?raw')).default as string;
        expect(src).toMatch(/\.btns :deep\(\.d-icon-btn\) \{ width: 20px; height: 20px; font-size: var\(--fs-md\); \}/);
    });
});

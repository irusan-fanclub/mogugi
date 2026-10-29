// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, DOMWrapper, type VueWrapper } from '@vue/test-utils';
import SkillTable from './SkillTable.vue';
import { condNameMap } from '@/store';
import type { EntityConditionState, EntityDamage } from '@/eventActor';
import type { PlayerVM } from './battleTypes';
import { useContextMenu } from '../../ui/useContextMenu';
import { setSkillCcList, skillCcModel } from './skillCcSettings';
import { activeDps, activeSeconds } from '@/lib/activeDps';
import { buildSkillRows } from '@/lib/skillRows';
import { PLAYER_NUM_COLUMNS } from './playerColumns';

function dmg(SkillId: number, At: number, TargetId = 'T'): EntityDamage {
    return {
        Id: 'P', At, TargetId, SkillId, Damage: 100, IsCritical: false, IsDelayed: false,
        Conditions: [], TargetConditions: [], PetId: '',
    };
}
const state = (At: number, ids: number[]): EntityConditionState =>
    ({ At, List: ids.map(CCId => ({ CCId })) } as unknown as EntityConditionState);

// Skill 1: 4 hits at 1..4, skill 2: 1 hit at 5.
const damages = [dmg(1, 1), dmg(1, 2), dmg(1, 3), dmg(1, 4), dmg(2, 5)];
const vm = {
    id: 'P', realName: 'P', name: 'P', arcana: 1, arcanaHidden: false, total: 500, spanSec: 4, dps: 0,
    activeDps: 40, activeSec: 10, share: 1, music: { kind: 'absent' }, hasCondition: false, damages, skillUses: [],
} as unknown as PlayerVM;

const bossHist = [state(0, [10]), state(3, [])];
const selfHist = [state(0, [20, 30])];

const mounted: VueWrapper[] = [];
afterEach(() => { mounted.splice(0).forEach(w => w.unmount()); });

function mountTable(over: Record<string, unknown> = {}) {
    const w = mount(SkillTable, {
        attachTo: document.body,
        props: {
            vm, columns: [], limit: 0, showAll: false, showPet: true, minAt: null, maxAt: null,
            skillName: (id: number) => `S${id}`,
            detailed: true,
            historyOf: (s: 'boss' | 'self') => (s === 'boss' ? bossHist : selfHist),
            seen: { boss: new Set([10]), self: new Set([20, 30]) },
            ...over,
        },
    });
    mounted.push(w);
    return w;
}

beforeEach(() => {
    condNameMap.value = { 10: '崩壞 1' };
    setSkillCcList('common', 'boss', [10, 11]); setSkillCcList('common', 'self', [20]); setSkillCcList(1, 'self', [30]);
});

describe('SkillTable detail toggle', () => {
    it('lives in the header row and adds no row', () => {
        const w = mountTable({ detailed: false });
        const head = w.get('.srow.head');
        expect(head.findAll('.seg button')).toHaveLength(2);
        expect(w.findAll('.srow')).toHaveLength(1 + 2);
        expect(w.findAll('.skill-detail')).toHaveLength(0);
    });

    it('emits update:detailed from the segments', async () => {
        const w = mountTable({ detailed: false });
        await w.findAll('.seg button')[1].trigger('click');
        expect(w.emitted('update:detailed')![0]).toEqual([true]);
        const w2 = mountTable();
        await w2.findAll('.seg button')[0].trigger('click');
        expect(w2.emitted('update:detailed')![0]).toEqual([false]);
    });
});

describe('SkillTable detail block', () => {
    it('renders one block per visible skill, sections BOSS then self, without section words', () => {
        const w = mountTable();
        const blocks = w.findAll('.skill-detail');
        expect(blocks).toHaveLength(2);
        expect(blocks[0].findAll('.cc-sec').map(s => s.attributes('data-sec'))).toEqual(['boss', 'self']);
        expect(blocks[0].findAll('.sec-label')).toHaveLength(0);
        expect(blocks[0].text()).not.toContain('自身 BUFF');
        expect(blocks[0].get('.dl-label').text()).toBe('CC 覆蓋');
    });

    it('one fill band owns both the skill row and its detail block', () => {
        const w = mountTable();
        const g = w.get('.skill-group');
        expect(g.find(':scope > .fill').exists()).toBe(true);
        expect(g.find(':scope > .skill-row').exists()).toBe(true);
        expect(g.find(':scope > .skill-detail').exists()).toBe(true);
        expect(g.findAll('.fill')).toHaveLength(1);
    });

    it('hides unseen CCs and formats title and one-decimal text', () => {
        const w = mountTable();
        const chips = w.get('.skill-detail').findAll('.cc-sec[data-sec="boss"] .chip');
        expect(chips).toHaveLength(1); // 11 never seen
        // boss CC 10 is active at At 1 and 2 only (cleared at 3): 2 / 4
        expect(chips[0].attributes('title')).toBe('崩壞：2 / 4 下（50.0%）');
        expect(chips[0].text()).toBe('50.0%');
        expect(chips[0].get('.pct').classes()).toContain('warn');
    });

    it('colours by the coverage thresholds', () => {
        const w = mountTable();
        const self = w.get('.skill-detail').findAll('.cc-sec[data-sec="self"] .chip .pct');
        expect(self[0].text()).toBe('100%');
        expect(self[0].classes()).toContain('ok');
    });

    it('alignment: every skill row has the same slots in the same order', () => {
        const w = mountTable();
        const ids = (i: number) => w.findAll('.skill-detail')[i].findAll('.chip').map(c => c.attributes('data-cc'));
        expect(ids(0)).toEqual(['10', '20', '30']);
        expect(ids(1)).toEqual(ids(0));
        // skill 2 is never covered by CC 10 but still shows the slot
        expect(w.findAll('.skill-detail')[1].get('.chip[data-cc="10"]').text()).toBe('0.0%');
    });

    it('per-player seen hides a whole slot; no seen CCs drops the section', () => {
        const w = mountTable({ seen: { boss: new Set([10]), self: new Set([20]) } });
        for (const b of w.findAll('.skill-detail')) expect(b.find('.chip[data-cc="30"]').exists()).toBe(false);
        const w2 = mountTable({ seen: { boss: new Set([10]), self: new Set() } });
        expect(w2.get('.skill-detail').findAll('.cc-sec')).toHaveLength(1);
    });
});

describe('SkillTable CC editing', () => {
    const ctx = useContextMenu();
    beforeEach(() => {
        setSkillCcList('common', 'boss', [10]); setSkillCcList('common', 'self', [20]); setSkillCcList(1, 'self', [30]);
        ctx.close();
    });
    const labels = () => ctx.state.items.flatMap(i => (i === 'divider' ? [] : [i.label]));
    const click = (label: string) => {
        const it = ctx.state.items.find(i => i !== 'divider' && i.label === label);
        if (!it || it === 'divider') throw new Error(`no item ${label}: ${labels().join('|')}`);
        it.action();
    };
    const plus = (w: ReturnType<typeof mountTable>) => w.get('[data-line="cc"] .cc-plus');
    // The popover is teleported to body, so query the document.
    const popEl = () => document.querySelector('.cc-pop') as HTMLElement | null;
    const grids = (_w?: unknown) => [...document.querySelectorAll('.cc-pop .cc-grid')].map(g => new DOMWrapper(g));
    const btnIds = (g: DOMWrapper<Element>) =>
        g.findAll('.cc-btn').map(b => b.attributes('title')!.split(' ').pop());

    it('has no plus in 精簡 mode', () => {
        expect(mountTable({ detailed: false }).find('.cc-plus').exists()).toBe(false);
    });
    it('popover lists untracked ids only, in two grids', async () => {
        const w = mountTable({ seen: { boss: new Set([10, 12]), self: new Set([20, 30, 40]) } });
        expect(popEl()).toBeNull();
        await plus(w).trigger('click');
        const g = grids(w);
        expect(g).toHaveLength(2);
        expect(btnIds(g[0])).toEqual(['12']);
        expect(btnIds(g[1])).toEqual(['40']);
        expect(popEl()!.textContent).toContain('BOSS 身上出現過');
        expect(popEl()!.textContent).toContain('這個角色身上出現過');
        expect(plus(w).attributes('aria-expanded')).toBe('true');
        expect(plus(w).attributes('aria-haspopup')).toBe('true');
    });
    it('popover is teleported out of the table with fixed positioning', async () => {
        const w = mountTable({ seen: { boss: new Set([12]), self: new Set() } });
        await plus(w).trigger('click');
        expect(w.find('.cc-pop').exists()).toBe(false);
        expect(popEl()!.parentElement).toBe(document.body);
        expect(getComputedStyle(popEl()!).position).toBe('fixed');
    });
    it('flips above the button when there is no room below', async () => {
        const rect = (top: number, height: number) =>
            ({ top, bottom: top + height, left: 10, right: 30, width: 20, height, x: 10, y: top, toJSON() {} }) as DOMRect;
        const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
            return this.classList.contains('cc-pop') ? rect(0, 100) : rect(this.classList.contains('cc-plus') ? 700 : 0, 20);
        });
        vi.stubGlobal('innerHeight', 768);
        try {
            const w = mountTable({ seen: { boss: new Set([12]), self: new Set() } });
            await plus(w).trigger('click');
            await new Promise(r => setTimeout(r));
            expect(popEl()!.style.top).toBe('598px'); // 700 - 100 - 2
        } finally { spy.mockRestore(); vi.unstubAllGlobals(); }
    });
    it('Esc closes the popover', async () => {
        const w = mountTable({ seen: { boss: new Set([12]), self: new Set() } });
        await plus(w).trigger('click');
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await w.vm.$nextTick();
        expect(popEl()).toBeNull();
    });
    it('pointerdown outside closes it; opening another closes the first', async () => {
        const w = mountTable({ seen: { boss: new Set([12]), self: new Set() } });
        const w2 = mountTable({ seen: { boss: new Set([12]), self: new Set() } });
        await plus(w).trigger('click');
        await plus(w2).trigger('click');
        expect(document.querySelectorAll('.cc-pop')).toHaveLength(1);
        expect(plus(w).attributes('aria-expanded')).toBe('false');
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        await w.vm.$nextTick();
        expect(popEl()).toBeNull();
    });
    it('picking a self icon offers 加到通用 and adds to common self', async () => {
        const w = mountTable({ seen: { boss: new Set([10]), self: new Set([20, 30, 40]) } });
        await plus(w).trigger('click');
        await grids(w)[1].get('.cc-btn').trigger('click');
        expect(labels()).toEqual(['加到通用', '加到〈元素騎士〉']);
        click('加到通用');
        expect(skillCcModel.value.common.self).toEqual([20, 40]);
    });
    it('picking a boss icon adds to the common boss list', async () => {
        const w = mountTable({ seen: { boss: new Set([10, 12]), self: new Set() } });
        await plus(w).trigger('click');
        await grids(w)[0].get('.cc-btn').trigger('click');
        click('加到通用');
        expect(skillCcModel.value.common.boss).toEqual([10, 12]);
    });
    it('adds to the arcana list by name, absent when arcana unknown', async () => {
        const w = mountTable({ seen: { boss: new Set(), self: new Set([40]) } });
        await plus(w).trigger('click');
        await grids(w)[1].get('.cc-btn').trigger('click');
        click('加到〈元素騎士〉');
        expect(skillCcModel.value.arcana[1].self).toEqual([30, 40]);
        const w2 = mountTable({ vm: { ...vm, arcana: 0 }, seen: { boss: new Set(), self: new Set([41]) } });
        await plus(w2).trigger('click');
        await grids(w2)[1].get('.cc-btn').trigger('click');
        expect(labels()).toEqual(['加到通用']);
    });
    it('right-click labels the removal by where the id lives', async () => {
        const w = mountTable();
        await w.get('[data-sec="self"] .chip[data-cc="20"]').trigger('contextmenu');
        expect(labels()).toEqual(['從通用 自身 移除']);
        click('從通用 自身 移除');
        expect(skillCcModel.value.common.self).toEqual([]);
        expect(skillCcModel.value.common.boss).toEqual([10]);
        await w.get('[data-sec="boss"] .chip').trigger('contextmenu');
        expect(labels()).toEqual(['從通用 BOSS 移除']);
        await w.get('[data-sec="self"] .chip[data-cc="30"]').trigger('contextmenu');
        expect(labels()).toEqual(['從〈元素騎士〉自身 移除']);
    });
    it('offers both removals when the id is in common and arcana', async () => {
        setSkillCcList(1, 'self', [20, 30]);
        const w = mountTable();
        await w.get('[data-sec="self"] .chip[data-cc="20"]').trigger('contextmenu');
        expect(labels()).toEqual(['從通用 自身 移除', '從〈元素騎士〉自身 移除']);
    });
});

describe('SkillTable player-aligned columns', () => {
    const numW = PLAYER_NUM_COLUMNS.filter(c => c.key !== 'time').map(c => `${c.width}px`);
    it('header ends with 總傷害 DPS 活躍DPS 佔比', () => {
        const labels = mountTable({ detailed: false }).get('.srow.head').findAll('.r').map(e => e.text());
        expect(labels.slice(-4)).toEqual(['總傷害', 'DPS', '活躍DPS', '佔比']);
    });
    it('the last four grid tracks reuse the player column widths', () => {
        const cols = mountTable().get('.grid').attributes('style')!;
        expect(cols).toContain(numW.join(' '));
        expect(cols.trim().replace(/;$/, '').endsWith(numW.join(' '))).toBe(true);
    });
    it('renders skill damage over the player active seconds, - when unknown', () => {
        const w = mountTable({ detailed: false });
        // skill 1 = 400 damage, active seconds 10
        expect(w.get('[data-skill="1"] .active').text()).toBe('0.04K');
        const w2 = mountTable({ detailed: false, vm: { ...vm, activeDps: null, activeSec: null } });
        expect(w2.get('[data-skill="1"] .active').text()).toBe('-');
    });
});

describe('SkillTable active values vs the player', () => {
    it('skill 活躍DPS sum to the player activeDps when hits are excluded', () => {
        const ds = [dmg(1, 1), dmg(1, 8), dmg(2, 3), dmg(2, 9)];
        const excluded: [number, number][] = [[0, 5]];
        const player = activeDps(ds, [[1, 9]], excluded)!;
        const w = mountTable({ vm: { ...vm, damages: ds, total: 400, activeSec: activeSeconds([[1, 9]], excluded), activeDps: player, excluded } });
        const cells = w.findAll('.skill-row .active').map(c => c.text());
        expect(cells).toHaveLength(2);
        const rows = buildSkillRows({
            damages: ds, skillUses: [], showPet: true, minAt: null, maxAt: null, skillName: String, playerSpanSec: 8,
            activeSec: activeSeconds([[1, 9]], excluded), excluded,
        });
        expect(rows.reduce((s, r) => s + (r.activeDps ?? 0), 0)).toBeCloseTo(player, 9);
    });

    it('explains the header', () => {
        const w = mountTable();
        expect(w.find('.srow.head [title]:last-of-type, .srow.head span[title^="技能活躍傷害"]').attributes('title'))
            .toBe('技能活躍傷害 ÷ 玩家活躍秒數（排除開場 5 秒、BOSS 無敵與死亡）');
    });
});

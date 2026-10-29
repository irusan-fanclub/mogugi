// @vitest-environment happy-dom
vi.mock('@/lib/runtimeEnv', async o => ({ ...(await o<object>()), isDesktop: () => true }));
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { resetSettingsForTest, settingsStorage } from '@/lib/settingsStorage';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';

const emitDesktop = vi.fn(async () => {});
// happy-dom has no canvas; the chart itself is covered by EChart/DpsTimeline tests.
vi.mock('../../charts/EChart.vue', () => ({
    default: {
        name: 'EChartStub', props: ['option', 'group', 'rebuildKey', 'height'],
        methods: { resetZoom() { /* nothing to reset */ } },
        render: () => h('div', { class: 'echart-stub' }),
    },
    zoomRangeOf: () => null,
}));
const captureBattle = vi.fn();
// Spy on the synthetic 戰吼 builder that buildSelfHistory calls for the owner.
vi.mock('@/lib/bardsongTrack', async orig => {
    const m = await orig<typeof import('@/lib/bardsongTrack')>();
    return { ...m, buildBardsongConditionHistory: vi.fn(m.buildBardsongConditionHistory) };
});
vi.mock('./screenshot', async orig => ({ ...(await orig<typeof import('./screenshot')>()), captureBattle: (...a: unknown[]) => captureBattle(...a) }));
vi.mock('@/lib/desktopBridge', () => ({ emitDesktop: (...a: unknown[]) => emitDesktop(...(a as [])) }));

import * as bardsongTrack from '@/lib/bardsongTrack';
import BattleTab from './BattleTab.vue';
import SkillTable from './SkillTable.vue';
import DContextMenu from '../../ui/DContextMenu.vue';
import { useContextMenu } from '../../ui/useContextMenu';
import { SESSION_KEY } from '../../session';
import { actorManager, dcManager, skillNameMap, setSkillRowLimit, clearTimeRange, setTimeRange, timeRangeMin, bossOnlyTarget, setBossOnlyTarget, hiddenTargetRaces, setHiddenTargetRaces } from '@/store';
import { aliasOf, clearAllAliases, setAlias } from '@/lib/entityAlias';
import { useToast } from '../../ui/useToast';
import { humanReadableNumber } from '@/lib/util';
import { selectedTargetId } from './battleSelection';

const A = '4503599630022001';
const B = '4503599630022002';
const MOB = '4767482418117579';
const BOSS = '4767482418117580';
const AT = 1784805900;

function appear(Id: string, RaceId: number, Name = `n:${Id}`) {
    return { EventId: 1, At: AT, Id, RaceId, Name, Height: 1, Weight: 1, Upper: 1, Lower: 1, GuildName: '', OwnerId: '' };
}
function hit(Id: string, SkillId: number, Damage: number, dt: number, TargetId = MOB) {
    return { EventId: 3, At: AT + dt, Id, TargetId, SkillId, Damage, IsCritical: false, IsDelayed: false };
}
function feed(...events: object[]) {
    for (const e of events) actorManager.value.onEvent(e as never);
}
function seed() {
    feed(appear(MOB, 4000, 'mob'), appear(A, 10002, '甲'), appear(B, 10002, '乙'));
    feed(hit(A, 58101, 1000, 0), hit(A, 58102, 500, 2), hit(B, 58101, 3000, 0), hit(B, 58101, 3000, 3));
}

const session = { clearData: vi.fn(), source: ref<{ ClientVersion?: string } | null>(null) };
let w: VueWrapper | null = null;
const Host = defineComponent({ setup: () => () => [h(BattleTab), h(DContextMenu)] });
function mountTab() {
    w = mount(Host, {
        attachTo: document.body,
        global: { provide: { [SESSION_KEY as symbol]: () => session } },
    });
    return w;
}
const rows = () => Array.from(document.querySelectorAll<HTMLElement>('.player'));
const names = () => rows().map(r => r.getAttribute('data-player'));

beforeEach(() => {
    actorManager.value.clear();
    // clear() keeps the actors; drop them so a stale boss is not auto-selected.
    for (const k of Object.keys(actorManager.value.entityMap)) delete actorManager.value.entityMap[k];
    for (const k of Object.keys(actorManager.value.groupMap)) delete actorManager.value.groupMap[k];
    dcManager.value.clear();
    clearTimeRange();
    clearAllAliases();
    setSkillRowLimit(0);
    setHiddenTargetRaces(new Set());
    resetSettingsForTest();
    emitDesktop.mockClear();
    session.clearData.mockClear();
    skillNameMap.value = { 58101: '技能一', 58102: '技能二' };
});
afterEach(() => {
    useContextMenu().close();
    w?.unmount();
    w = null;
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('BattleTab 自身 history', () => {
    it('builds the owner self history once and returns the same array for every hit', async () => {
        seed();
        feed({ EventId: 14, At: AT, Id: A });
        mountTab();
        await flushPromises();
        for (const r of rows()) r.querySelector<HTMLElement>('.num-total')!.click();
        await nextTick();
        const spy = vi.mocked(bardsongTrack.buildBardsongConditionHistory);
        spy.mockClear();
        const tables = w!.findAllComponents(SkillTable);
        for (const t of tables) {
            const historyOf = t.props('historyOf');
            const hits = t.props('vm').damages;
            const first = historyOf('self', hits[0]);
            for (const h of hits) expect(historyOf('self', h)).toBe(first);
        }
        expect(spy).toHaveBeenCalledTimes(1);
    });
});

describe('BattleTab 自身 seen follows a growing history', () => {
    it('a 自身 buff that arrives after the table was built still shows up', async () => {
        seed();
        feed({ EventId: 14, At: AT - 5, Id: A });
        mountTab();
        await flushPromises();
        for (const r of rows()) r.querySelector<HTMLElement>('.num-total')!.click();
        await nextTick();
        const rowA = rows().find(r => r.getAttribute('data-player') === '甲')!;
        rowA.querySelectorAll<HTMLElement>('.seg button')[1].click();
        await nextTick();
        const tableA = () => w!.findAllComponents(SkillTable).find(c => c.props('vm').realName === '甲')!;
        expect(tableA().props('seen').self.has(516)).toBe(false);
        feed({ EventId: 4, At: AT + 1, Id: A, CCId: 516, DisableAt: AT + 60, AttackerId: A, Params: {} });
        actorManager.value.forceUpdateAll(); // skip the 33ms batched trigger
        await nextTick();
        await flushPromises();
        expect(tableA().props('seen').self.has(516)).toBe(true);
        expect(rowA.querySelector('.cc-sec[data-sec="self"] .chip[data-cc="516"]')).not.toBeNull();
    });
});

describe('BattleTab 自身 history owner switch', () => {
    it('the synthetic 戰吼 track follows the new owner', async () => {
        seed();
        feed({ EventId: 14, At: AT - 5, Id: A });
        mountTab();
        await flushPromises();
        for (const r of rows()) r.querySelector<HTMLElement>('.num-total')!.click();
        await nextTick();
        const spy = vi.mocked(bardsongTrack.buildBardsongConditionHistory);
        const callFor = (name: string) => {
            const t = w!.findAllComponents(SkillTable).find(c => c.props('vm').realName === name)!;
            spy.mockClear();
            t.props('historyOf')('self', t.props('vm').damages[0]);
            return spy.mock.calls.length;
        };
        expect(callFor('甲')).toBe(1);
        expect(callFor('乙')).toBe(0);
        feed({ EventId: 14, At: AT, Id: B });
        await flushPromises();
        expect(callFor('甲')).toBe(0);
        expect(callFor('乙')).toBe(1);
    });
});

describe('BattleTab list', () => {
    it('renders one row per player sorted by total damage', async () => {
        seed();
        mountTab();
        await flushPromises();
        expect(names()).toEqual(['乙', '甲']);
        const first = rows()[0];
        expect(first.querySelector('.num-total')!.textContent).toContain('6');
        expect(first.querySelector('.num-share')!.textContent).toMatch(/80\.0%/);
    });

    it('shows the DPS timeline above the list only when there is damage', async () => {
        feed(appear(MOB, 4000), appear(A, 10002, '甲'));
        mountTab();
        await flushPromises();
        expect(document.querySelector('.echart-stub')).toBeNull();
        w!.unmount();
        seed();
        mountTab();
        await flushPromises();
        const chart = document.querySelector('.echart-stub')!;
        expect(chart).not.toBeNull();
        expect(chart.compareDocumentPosition(document.querySelector('.list')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('hides players with no damage', async () => {
        feed(appear(MOB, 4000), appear(A, 10002, '甲'));
        mountTab();
        await flushPromises();
        expect(rows()).toHaveLength(0);
    });

    it('clicking the name does not expand; clicking elsewhere on the row does', async () => {
        seed();
        mountTab();
        await flushPromises();
        document.querySelector<HTMLElement>('.player .pname')!.click();
        await nextTick();
        expect(document.querySelector('.skill-table')).toBeNull();
        document.querySelector<HTMLElement>('.player .num-total')!.click();
        await nextTick();
        expect(document.querySelectorAll('.skill-table')).toHaveLength(1);
        // several players can be open at once
        rows()[1].querySelector<HTMLElement>('.num-total')!.click();
        await nextTick();
        expect(document.querySelectorAll('.skill-table')).toHaveLength(2);
    });

    it('keeps the expanded state by real name when an alias changes', async () => {
        seed();
        setAlias('乙', '蘑菇雞');
        mountTab();
        await flushPromises();
        document.querySelector<HTMLElement>('.player .num-total')!.click();
        await nextTick();
        expect(document.querySelectorAll('.skill-table')).toHaveLength(1);
        expect(rows()[0].querySelector('.skill-table')).not.toBeNull();
    });

    it('keeps 詳細 per player', async () => {
        seed();
        mountTab();
        await flushPromises();
        for (const r of rows()) r.querySelector<HTMLElement>('.num-total')!.click();
        await nextTick();
        expect(document.querySelectorAll('.skill-detail')).toHaveLength(0);
        // rows()[0] is 乙; switch only that player to 詳細
        rows()[0].querySelectorAll<HTMLElement>('.seg button')[1].click();
        await nextTick();
        expect(rows()[0].querySelectorAll('.skill-detail').length).toBeGreaterThan(0);
        expect(rows()[1].querySelectorAll('.skill-detail')).toHaveLength(0);
    });

    it('pins the no-wrap / ellipsis layout contract for the 640px minimum', async () => {
        seed();
        mountTab();
        await flushPromises();
        for (const r of document.querySelectorAll<HTMLElement>('.player-row')) {
            expect(r.style.display).toBe('flex');
            expect(r.style.flexWrap).toBe('nowrap');
            expect(r.style.overflow).toBe('hidden');
        }
        for (const n of document.querySelectorAll<HTMLElement>('.player .pname')) {
            expect(['0', '0px']).toContain(n.style.minWidth);
            expect(n.style.textOverflow).toBe('ellipsis');
            expect(n.style.whiteSpace).toBe('nowrap');
            expect(n.style.overflow).toBe('hidden');
        }
    });

    it('switches the music cell to icon-only below 720px and back at 720px', async () => {
        let cb: (e: unknown[]) => void = () => {};
        vi.stubGlobal('ResizeObserver', class {
            constructor(f: (e: unknown[]) => void) { cb = f; }
            observe() {}
            disconnect() {}
        });
        seed();
        mountTab();
        await flushPromises();
        expect(document.querySelector('.music')!.classList.contains('compact')).toBe(false);
        cb([{ contentRect: { width: 719 } }]);
        await nextTick();
        expect(document.querySelectorAll('.music.compact')).toHaveLength(2);
        cb([{ contentRect: { width: 720 } }]);
        await nextTick();
        expect(document.querySelectorAll('.music.compact')).toHaveLength(0);
        vi.unstubAllGlobals();
    });
});

describe('BattleTab active DPS', () => {
    const activeText = () => document.querySelector('.player [data-active-dps]')!.textContent;
    const ccOn = (CCId: number, dt: number) => ({ EventId: 4, At: AT + dt, Id: BOSS, CCId, DisableAt: 0, AttackerId: A, Params: {} });
    const ccOff = (CCId: number, dt: number) => ({ EventId: 5, At: AT + dt, Id: BOSS, CCId });
    const hits = (target: string) => [
        hit(A, 58101, 1000, 0, target), hit(A, 58101, 1000, 2, target), hit(A, 58101, 3000, 50, target),
        hit(A, 58101, 5000, 80, target), hit(A, 58101, 1000, 100, target),
    ];

    it('excludes the opening and the boss invincible span for the selected target', async () => {
        feed(appear(BOSS, 4856, 'boss'), appear(A, 10002, '甲'), ccOn(494, 70), ccOff(494, 90), ...hits(BOSS));
        mountTab();
        await flushPromises();
        const expected = humanReadableNumber(4000 / 75);
        expect(activeText()).toBe(expected);
    });

    it('excludes only the opening without a target', async () => {
        feed(appear(MOB, 4000, 'mob'), appear(A, 10002, '甲'), ...hits(MOB));
        mountTab();
        await flushPromises();
        expect(activeText()).toBe(humanReadableNumber(9000 / 95));
    });
});

describe('BattleTab skill table', () => {
    async function expandFirst() {
        seed();
        mountTab();
        await flushPromises();
        document.querySelector<HTMLElement>('.player .num-total')!.click();
        await nextTick();
    }

    it('lists skills with their damage', async () => {
        await expandFirst();
        const sk = Array.from(document.querySelectorAll<HTMLElement>('.skill-row'));
        expect(sk).toHaveLength(1);
        expect(sk[0].textContent).toContain('技能一');
    });

    it('skill rows have no chart buttons', async () => {
        await expandFirst();
        expect(document.querySelector('.skill-row [aria-label="次數"]')).toBeNull();
        expect(document.querySelector('.skill-row [aria-label="分佈"]')).toBeNull();
        expect(document.querySelector('.skill-row .btns')).toBeNull();
    });

    it('clicking a skill row opens the hit log for that skill', async () => {
        await expandFirst();
        document.querySelector<HTMLElement>('.skill-row')!.click();
        await nextTick();
        expect(emitDesktop).toHaveBeenCalledTimes(1);
        const payload = (emitDesktop.mock.calls[0] as unknown as [string, { kind: string; spec: string; title: string }])[1];
        expect(payload.kind).toBe('hitlog');
        expect(JSON.parse(payload.spec)).toMatchObject({ attackerId: B, targetId: '', skillId: 58101 });
        expect(payload.title).toBe('乙 → 技能一');
    });

    it('limits rows and offers show-all / collapse', async () => {
        feed(appear(MOB, 4000), appear(A, 10002, '甲'));
        feed(hit(A, 58101, 1000, 0), hit(A, 58102, 500, 2));
        setSkillRowLimit(1);
        mountTab();
        await flushPromises();
        document.querySelector<HTMLElement>('.player .num-total')!.click();
        await nextTick();
        expect(document.querySelectorAll('.skill-row')).toHaveLength(1);
        const more = document.querySelector<HTMLElement>('.skill-more')!;
        expect(more.textContent).toContain('顯示全部 2 個技能');
        more.click();
        await nextTick();
        expect(document.querySelectorAll('.skill-row')).toHaveLength(2);
        expect(document.querySelector('.skill-more')!.textContent).toContain('收合');
    });
});

describe('BattleTab player buttons and bar', () => {
    it('the share bar opens the hit log without expanding', async () => {
        seed();
        mountTab();
        await flushPromises();
        const row = rows()[0];
        expect(row.querySelector('.player-row [aria-label="DPS"]')).toBeNull();
        expect(row.querySelector('.player-row [aria-label="累積"]')).toBeNull();
        row.querySelector<HTMLElement>('.share-bar')!.click();
        await nextTick();
        const kinds = emitDesktop.mock.calls.map(c => (c as unknown as [string, { kind: string }])[1].kind);
        expect(kinds).toEqual(['hitlog']);
        expect(document.querySelector('.skill-table')).toBeNull();
    });

    it('the timeline button is disabled without condition history', async () => {
        seed();
        mountTab();
        await flushPromises();
        const btn = rows()[0].querySelector<HTMLButtonElement>('[aria-label="狀態時間軸"]')!;
        expect(btn.disabled).toBe(true);
    });

    it('the arcana icon toggles hiding without expanding', async () => {
        seed();
        mountTab();
        await flushPromises();
        const icon = rows()[0].querySelector<HTMLElement>('.arcana')!;
        expect(icon.getAttribute('data-hidden')).toBe('false');
        icon.click();
        await nextTick();
        expect(rows()[0].querySelector('.arcana')!.getAttribute('data-hidden')).toBe('true');
        expect(document.querySelector('.skill-table')).toBeNull();
    });
});

describe('BattleTab copy failure', () => {
    it('shows a failure toast when the clipboard write rejects', async () => {
        seed();
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied'); }) }, configurable: true });
        const { items } = useToast();
        items.splice(0);
        mountTab();
        await flushPromises();
        rows()[0].querySelector('.player-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await nextTick();
        (Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(i => i.textContent?.trim() === '複製名稱'))!.click();
        await flushPromises();
        expect(items.map(t => t.text)).toContain('複製失敗');
    });
});

// The capture waits two animation frames for the 960px relayout.
const settleShot = async () => { await flushPromises(); await new Promise(r => setTimeout(r, 50)); await flushPromises(); };

describe('BattleTab context menus', () => {
    const menuLabels = () => Array.from(document.querySelectorAll('[role="menuitem"]')).map(i => i.textContent?.trim());
    const clickItem = (label: string) =>
        (Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(i => i.textContent?.trim() === label))!.click();

    it('player row menu copies the shown (alias) name', async () => {
        seed();
        setAlias('乙', '蘑菇雞');
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        mountTab();
        await flushPromises();
        rows()[0].querySelector('.player-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
        await nextTick();
        expect(menuLabels()).toEqual(expect.arrayContaining(['展開', '開全部命中', '複製名稱', '改別名', '隨機別名', '隱藏秘法']));
        clickItem('複製名稱');
        await flushPromises();
        expect(writeText).toHaveBeenCalledWith('蘑菇雞');
    });

    it('player row menu restores the real name, disabled without an alias', async () => {
        seed();
        setAlias('乙', '蘑菇雞');
        mountTab();
        await flushPromises();
        const open = async (i: number) => {
            rows()[i].querySelector('.player-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
            await nextTick();
        };
        const restore = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(i => i.textContent?.trim() === '還原名稱')!;
        const row = rows().findIndex(r => r.textContent?.includes('蘑菇雞'));
        await open(row);
        expect(restore().getAttribute('aria-disabled')).toBeNull();
        restore().click();
        await nextTick();
        expect(aliasOf('乙')).toBeUndefined();
        await open(row);
        expect(restore().getAttribute('aria-disabled')).toBe('true');
    });

    it('the time filter bar sits above the DPS chart and clears the range', async () => {
        seed();
        mountTab();
        await flushPromises();
        expect(document.querySelector('[data-time-filter]')).toBeNull();
        setTimeRange(AT, AT + 5);
        await nextTick();
        const bar = document.querySelector<HTMLElement>('.battle > [data-time-filter]')!;
        expect(bar.nextElementSibling!.querySelector('.dps-timeline')).not.toBeNull();
        bar.querySelector<HTMLElement>('[data-clear-filter]')!.click();
        await nextTick();
        expect(timeRangeMin.value).toBeNull();
    });

    it('player row menu expands the row', async () => {
        seed();
        mountTab();
        await flushPromises();
        rows()[0].querySelector('.player-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await nextTick();
        clickItem('展開');
        await nextTick();
        expect(document.querySelectorAll('.skill-table')).toHaveLength(1);
    });

    it('skill row menu opens the hit log and copies the skill name', async () => {
        seed();
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        mountTab();
        await flushPromises();
        document.querySelector<HTMLElement>('.player .num-total')!.click();
        await nextTick();
        document.querySelector('.skill-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await nextTick();
        expect(menuLabels()).toEqual(['開命中紀錄', '複製技能名稱']);
        clickItem('開命中紀錄');
        await nextTick();
        expect(emitDesktop).toHaveBeenCalledTimes(1);
        expect((emitDesktop.mock.calls[0] as unknown as [string, { kind: string }])[1].kind).toBe('hitlog');
        document.querySelector('.skill-row')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await nextTick();
        clickItem('複製技能名稱');
        await flushPromises();
        expect(writeText).toHaveBeenCalledWith('技能一');
    });
});

describe('BattleTab toolbar and targets', () => {
    it('lists targets and filters the players by the chosen one', async () => {
        const MOB2 = '4767482418117581';
        feed(appear(MOB, 4000, 'mob'), appear(MOB2, 4001, 'mob2'), appear(A, 10002, '甲'), appear(B, 10002, '乙'));
        feed(hit(A, 58101, 1000, 0), hit(B, 58101, 3000, 1, MOB2));
        mountTab();
        await flushPromises();
        expect(names()).toEqual(['乙', '甲']);
        document.querySelector<HTMLElement>('[data-select-box]')!.click();
        await nextTick();
        const opts = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
        expect(opts).toHaveLength(3);
        opts[1].click(); // largest target: MOB2
        await flushPromises();
        expect(names()).toEqual(['乙']);
    });

    it('hiding a target removes it and offers to restore', async () => {
        seed();
        mountTab();
        await flushPromises();
        document.querySelector<HTMLElement>('[data-select-box]')!.click();
        await nextTick();
        document.querySelector<HTMLElement>('[role="option"] [data-hide-target]')!.click();
        await nextTick();
        expect(document.querySelectorAll('[role="option"]')).toHaveLength(1);
        expect(document.body.textContent).toContain('已隱藏 1 種目標，點此恢復');
    });

    it('auto-selects a newly appeared boss', async () => {
        seed();
        feed(appear(BOSS, 4856, 'boss'), hit(A, 58101, 100, 5, BOSS));
        mountTab();
        await flushPromises();
        const box = document.querySelector<HTMLElement>('[data-select-box]')!;
        expect(box.textContent).toContain('unknownRace:4856');
        expect(box.textContent).not.toMatch(/\d+(\.\d+)?[KMB]/);
        expect(names()).toEqual(['甲']);
    });

    it('toolbar is a single row in the designed order without a hint', async () => {
        seed();
        mountTab();
        await flushPromises();
        expect(document.querySelectorAll('.toolbar .line')).toHaveLength(1);
        expect(document.querySelector('.toolbar .hint')).toBeNull();
        const texts = Array.from(document.querySelectorAll('.toolbar .line button'))
            .map(b => b.textContent?.trim() || b.getAttribute('aria-label'));
        const order = ['隨機名稱', '還原名稱', '隱藏秘法', '截圖', '設定', '清除資料'];
        const idx = order.map(t => texts.indexOf(t));
        expect(idx.every(i => i >= 0)).toBe(true);
        expect([...idx].sort((a, b) => a - b)).toEqual(idx);
        const titleOf = (t: string) => Array.from(document.querySelectorAll<HTMLElement>('.toolbar button')).find(b => b.textContent?.trim() === t)!.title;
        expect([titleOf('隨機名稱'), titleOf('還原名稱')]).toEqual(['別名只存在本次執行，關閉後不保留', '別名只存在本次執行，關閉後不保留']);
        expect(titleOf('隱藏秘法')).toBe('隱藏所有玩家的秘法圖示');
    });

    it('the header puts 音樂 over the rows music cell', async () => {
        seed();
        mountTab();
        await flushPromises();
        await nextTick();
        const label = document.querySelector<HTMLElement>('[data-music-label]')!;
        expect(label.classList.contains('placed')).toBe(true);
        expect(label.style.left).toMatch(/^\d+px$/);
    });

    it('只看 BOSS lives in the target menu next to the search', async () => {
        seed();
        mountTab();
        await flushPromises();
        expect(Array.from(document.querySelectorAll('.toolbar .line > button')).some(b => b.textContent?.trim() === '只看 BOSS')).toBe(false);
        document.querySelector<HTMLElement>('[data-select-box]')!.click();
        await nextTick();
        const btn = document.querySelector<HTMLElement>('.search [data-boss-only]')!;
        expect(btn.getAttribute('aria-pressed')).toBe('false');
        btn.click();
        await nextTick();
        expect(bossOnlyTarget.value).toBe(true);
        expect(document.querySelector('[data-boss-only]')!.getAttribute('aria-pressed')).toBe('true');
        setBossOnlyTarget(false);
    });

    it('hiding a target race persists it in the settings list', async () => {
        seed();
        mountTab();
        await flushPromises();
        document.querySelector<HTMLElement>('[data-select-box]')!.click();
        await nextTick();
        const before = document.querySelectorAll('[role="option"]').length;
        document.querySelector<HTMLElement>('[data-hide-target]')!.click();
        await nextTick();
        expect(document.querySelectorAll('[role="option"]').length).toBe(before - 1);
        expect(hiddenTargetRaces.value.size).toBe(1);
        expect(JSON.parse(settingsStorage.getItem('config')!).hiddenTargetRaces).toEqual([...hiddenTargetRaces.value]);
        setHiddenTargetRaces(new Set());
    });

    it('boss items carry a BOSS badge, others do not', async () => {
        seed();
        feed(appear(BOSS, 4856, 'boss'), hit(A, 58101, 100, 5, BOSS));
        mountTab();
        await flushPromises();
        document.querySelector<HTMLElement>('[data-select-box]')!.click();
        await nextTick();
        const opts = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
        const badged = opts.filter(o => o.querySelector('.boss-badge'));
        expect(badged).toHaveLength(1);
        expect(badged[0].querySelector('.boss-badge')!.textContent).toBe('BOSS');
    });

    it('falls back to no selection when the selected target is evicted', async () => {
        seed();
        mountTab();
        await flushPromises();
        selectedTargetId.value = MOB;
        await flushPromises();
        expect(() => {
            actorManager.value.evictBefore(AT + 100, []);
            dcManager.value.evictBefore(AT + 100);
        }).not.toThrow();
        await flushPromises();
        expect(selectedTargetId.value).toBe('');
        expect(names()).toEqual([]);
    });

    it('random names then restore names', async () => {
        seed();
        mountTab();
        await flushPromises();
        const btn = (t: string) => Array.from(document.querySelectorAll<HTMLElement>('button')).find(b => b.textContent?.trim() === t)!;
        btn('隨機名稱').click();
        await flushPromises();
        expect(document.querySelector('.player .pname')!.textContent).not.toBe('乙');
        expect(rows()[0].getAttribute('data-player')).toBe('乙');
        btn('還原名稱').click();
        await flushPromises();
        expect(document.querySelector('.player .pname')!.textContent).toBe('乙');
    });

    it('清除資料 asks first; cancel keeps the data, confirm clears it', async () => {
        seed();
        mountTab();
        await flushPromises();
        document.querySelector<HTMLElement>('[data-clear-data]')!.click();
        await nextTick();
        expect(document.querySelector('[data-clear-confirm]')).not.toBeNull();
        expect(session.clearData).not.toHaveBeenCalled();
        Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"] button')).find(b => b.textContent?.trim() === '取消')!.click();
        await nextTick();
        expect(session.clearData).not.toHaveBeenCalled();
        document.querySelector<HTMLElement>('[data-clear-data]')!.click();
        await nextTick();
        document.querySelector<HTMLElement>('[data-clear-ok]')!.click();
        expect(session.clearData).toHaveBeenCalledTimes(1);
    });

    it('settings button opens the settings dialog', async () => {
        seed();
        mountTab();
        await flushPromises();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        document.querySelector<HTMLElement>('[aria-label="設定"]')!.click();
        await nextTick();
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain('傷害分析設定');
    });

    it.each([
        ['clipboard', '已截圖到剪貼簿'],
        ['download', '無法寫入剪貼簿（視窗失焦或權限不足），已改為下載 PNG'],
        ['empty', '沒有可截圖的內容'],
    ] as const)('screenshot result %s shows its toast', async (result, text) => {
        seed();
        mountTab();
        await flushPromises();
        captureBattle.mockResolvedValueOnce(result);
        document.querySelector<HTMLElement>('[aria-label="截圖"]')!.click();
        await settleShot();
        expect(useToast().items.map(t => t.text)).toContain(text);
        expect(captureBattle.mock.calls[0][1]).toMatchObject({ version: __APP_VERSION__ });
    });

    it('screenshot passes the detected client version', async () => {
        seed();
        session.source.value = { ClientVersion: 'tw100' };
        mountTab();
        await flushPromises();
        captureBattle.mockResolvedValueOnce('clipboard');
        document.querySelector<HTMLElement>('[aria-label="截圖"]')!.click();
        await settleShot();
        expect(captureBattle.mock.lastCall![1]).toMatchObject({ client: 'tw100' });
        session.source.value = null;
    });

    it('screenshot never resizes the live tab; the clone is laid out at 960px', async () => {
        seed();
        mountTab();
        await flushPromises();
        const root = document.querySelector<HTMLElement>('.battle')!;
        let widthDuring: string | null = null;
        captureBattle.mockImplementationOnce(async (_el: unknown, _f: unknown, prepare: (d: Document) => Promise<void>) => {
            widthDuring = root.style.width;
            const doc = document.implementation.createHTMLDocument('clone');
            doc.body.innerHTML = '<div data-shot-root></div>';
            await prepare(doc);
            expect(doc.querySelector<HTMLElement>('[data-shot-root]')!.style.width).toBe('960px');
            return 'clipboard';
        });
        document.querySelector<HTMLElement>('[aria-label="截圖"]')!.click();
        await settleShot();
        expect(widthDuring).toBe('');
        expect(captureBattle).toHaveBeenCalled();
    });

    it('screenshot context names the target, and the range only when filtered', async () => {
        seed();
        mountTab();
        await flushPromises();
        captureBattle.mockResolvedValue('clipboard');
        document.querySelector<HTMLElement>('[aria-label="截圖"]')!.click();
        await settleShot();
        expect(captureBattle.mock.lastCall![1].context).toBe('目標：全部目標');
        setTimeRange(AT + 1, AT + 3);
        await nextTick();
        document.querySelector<HTMLElement>('[aria-label="截圖"]')!.click();
        await settleShot();
        expect(captureBattle.mock.lastCall![1].context).toMatch(/^目標：全部目標｜範圍：\d+:\d\d ~ \d+:\d\d$/);
    });

    it('screenshot failure shows 截圖失敗', async () => {
        seed();
        mountTab();
        await flushPromises();
        captureBattle.mockRejectedValueOnce(new Error('x'));
        document.querySelector<HTMLElement>('[aria-label="截圖"]')!.click();
        await settleShot();
        expect(useToast().items.map(t => t.text)).toContain('截圖失敗');
    });
});

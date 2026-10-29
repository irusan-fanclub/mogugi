// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { settingsStorage } from '@/lib/settingsStorage';
import { defineComponent, h } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';
import BattleSettings from './BattleSettings.vue';
import DContextMenu from '../../ui/DContextMenu.vue';
import { useContextMenu } from '../../ui/useContextMenu';
import {
    chartHiddenCCIds, resetCCTracking, trackedCCIds, selfTrackedCCIds, setSelfTrackedCCIds, setTrackedCCIds, setChartHiddenCCIds,
} from './ccSettings';
import { ccPickMode, setCcPickMode } from './ccPickMode';
import {
    hiddenSkillColumns, skillRowLimit, setSkillRowLimit, resetSkillSettings, condNameMap, raceNameMap,
    bossRaceIds, resetBossRaces, hpGuideStep, setHpGuideStep,
    hiddenTargetRaces, setHiddenTargetRaces,
} from '@/store';
import { DEFAULT_CC_LIST, DEFAULT_SELF_CC_LIST } from '@/lib/ccTracking';

let w: VueWrapper | null = null;
beforeEach(() => {
    resetCCTracking();
    resetSkillSettings();
    resetBossRaces();
    condNameMap.value = {};
    raceNameMap.value = {};
    setCcPickMode('list');
    setHpGuideStep(25);
});
afterEach(() => { useContextMenu().close(); w?.unmount(); w = null; document.body.innerHTML = ''; });

const mountSettings = () => (w = mount(BattleSettings, {
    props: { modelValue: true, target: null, self: null }, attachTo: document.body,
}));
const q = (sel: string) => document.querySelector<HTMLElement>(sel)!;
const qa = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
const tabs = () => qa('.settings > .d-segmented [role="radio"]');
async function gotoTab(label: string) {
    tabs().find(r => r.textContent?.trim() === label)!.click();
    await nextTick();
}
const rowOf = (text: string) => qa('.row').find(r => r.textContent?.includes(text))!;

describe('BattleSettings dialog', () => {
    it('has four tabs and opens on 一般', () => {
        mountSettings();
        expect(tabs().map(r => r.textContent?.trim())).toEqual(['一般', 'DPS 圖表 CC', '技能圖表', '技能圖表 CC']);
        expect(q('[data-tab="general"]')).toBeTruthy();
    });

    it('一般 sets the HP guide interval, 0 turning them off', async () => {
        mountSettings();
        const opts = qa('[data-guide-step] [role="radio"]');
        expect(opts.map(r => r.textContent?.trim())).toEqual(['關閉', '5%', '10%', '20%', '25%', '50%']);
        expect(opts.find(r => r.getAttribute('aria-checked') === 'true')!.textContent?.trim()).toBe('25%');
        opts[2].click();
        await nextTick();
        expect(hpGuideStep.value).toBe(10);
        expect(JSON.parse(settingsStorage.getItem('config')!).hpGuideStep).toBe(10);
        opts[0].click();
        await nextTick();
        expect(hpGuideStep.value).toBe(0);
    });

    it('一般 turns the HP ruler, the invincible tint and the cast ticks on and off', async () => {
        const { showHpRuler, showInvincible, showCastTicks, setShowHpRuler, setShowInvincible, setShowCastTicks } = await import('@/store');
        mountSettings();
        for (const [attr, ref, set] of [
            ['data-show-hp-ruler', showHpRuler, setShowHpRuler],
            ['data-show-invincible', showInvincible, setShowInvincible],
            ['data-show-cast-ticks', showCastTicks, setShowCastTicks],
        ] as const) {
            expect(ref.value).toBe(true);
            const sw = q(`[${attr}]`);
            (sw.matches('[role="switch"]') ? sw : sw.querySelector<HTMLElement>('[role="switch"], input, button')!).click();
            await nextTick();
            expect(ref.value).toBe(false);
            set(true);
        }
    });

    describe('DPS tab', () => {
        beforeEach(async () => { mountSettings(); await gotoTab('DPS 圖表 CC'); });
        it('no row is locked: first row is draggable and removable', () => {
            const row = qa('.row')[0];
            expect(row.getAttribute('draggable')).toBe('true');
            expect(row.querySelector('[data-remove]')).toBeTruthy();
            expect(row.querySelector('.mdi-lock')).toBeNull();
        });

        it('chart-mode toggle writes through ccSettings and settingsStorage', async () => {
            expect(chartHiddenCCIds.value.has(803)).toBe(false);
            rowOf('803').querySelector<HTMLElement>('[data-chart-toggle] button')!.click();
            await nextTick();
            expect(chartHiddenCCIds.value.has(803)).toBe(true);
            expect(JSON.parse(settingsStorage.getItem('chartHiddenCCIds')!)).toContain(803);
        });

        it('other rows can be removed', async () => {
            rowOf('803').querySelector<HTMLElement>('[data-remove] button')!.click();
            await nextTick();
            expect(trackedCCIds.value).not.toContain(803);
            expect(JSON.parse(settingsStorage.getItem('trackedDebuffCCIds')!)).not.toContain(803);
        });

        it('dragging a row onto the first row moves it to index 0', async () => {
            const rows = qa('[data-boss] .row');
            const last = rows.length - 1;
            const moved = trackedCCIds.value[last];
            rows[last].dispatchEvent(new Event('dragstart', { bubbles: true }));
            rows[0].dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
            await nextTick();
            expect(trackedCCIds.value[0]).toBe(moved);
        });

        it('reset restores both defaults', async () => {
            rowOf('803').querySelector<HTMLElement>('[data-remove] button')!.click();
            rowOf('1026').querySelector<HTMLElement>('[data-chart-toggle] button')!.click();
            await nextTick();
            qa('button').find(b => b.textContent?.trim() === '重設')!.click();
            await nextTick();
            expect(trackedCCIds.value).toEqual(DEFAULT_CC_LIST);
            expect(chartHiddenCCIds.value.has(1026)).toBe(false);
        });

        it('add list: click adds, search filters, empty and overflow texts', async () => {
            condNameMap.value = Object.fromEntries(Array.from({ length: 400 }, (_, i) => [90000 + i, `狀態${i}號`]));
            // Seen-only with no target offers just untracked defaults (none) -> empty text.
            expect(q('[data-empty]').textContent).toContain('沒有更多可新增的狀態');
            // Switch off 只顯示出現過.
            qa('[role="switch"], [role="checkbox"]').find(e => e.textContent?.includes('只顯示出現過'))!.click();
            await nextTick();
            expect(qa('[data-add]')).toHaveLength(300);
            expect(q('[data-overflow]').textContent).toContain('還有 100 筆，請用搜尋縮小範圍');
            const input = q('input[placeholder^="搜尋 CC"]') as HTMLInputElement;
            input.value = '狀態7';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await nextTick();
            const first = qa('[data-add]')[0];
            expect(first.textContent).toContain('狀態7');
            first.click();
            await nextTick();
            expect(trackedCCIds.value.at(-1)).toBeGreaterThanOrEqual(90000);
        });
    });

    describe('self block', () => {
        beforeEach(async () => { mountSettings(); await gotoTab('DPS 圖表 CC'); });
        const selfRows = () => qa('[data-self] .row');
        it('shows 自身 with the defaults; removing one drops it', async () => {
            expect(q('[data-self]').textContent).toContain('自身');
            expect(selfRows()).toHaveLength(DEFAULT_SELF_CC_LIST.length);
            selfRows().find(r => r.textContent?.includes('476'))!.querySelector<HTMLElement>('[data-remove] button')!.click();
            await nextTick();
            const left = DEFAULT_SELF_CC_LIST.filter(id => id !== 476);
            expect(selfTrackedCCIds.value).toEqual(left);
            expect(JSON.parse(settingsStorage.getItem('trackedSelfCCIds')!)).toEqual(left);
        });
        it('seen-only add list reads the provided 自身 history (e.g. synthetic 戰吼)', async () => {
            w?.unmount(); w = null;
            const w2 = mount(BattleSettings, {
                props: {
                    modelValue: true, target: null, self: null,
                    selfHistory: [{ At: 1, List: [{ CCId: 424242 }] }],
                } as never,
                attachTo: document.body,
            });
            await nextTick();
            await gotoTab('DPS 圖表 CC');
            expect(qa('[data-self-add]').some(e => e.textContent?.includes('424242'))).toBe(true);
            w2.unmount();
        });
        it('resetCCTracking restores the self list', () => {
            setSelfTrackedCCIds([1]);
            resetCCTracking();
            expect(selfTrackedCCIds.value).toEqual(DEFAULT_SELF_CC_LIST);
        });
    });

    describe('DPS tab icon mode', () => {
        const menu = () => qa('[role="menuitem"]');
        const item = (label: string) => menu().find(m => m.textContent?.trim() === label)!;
        const icons = (sel: string) => qa(`[data-boss] ${sel} [data-cc]`).map(e => Number(e.dataset.cc));
        const rightClick = (el: HTMLElement) => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        beforeEach(async () => {
            setCcPickMode('icon');
            setTrackedCCIds([1, 2, 3, 4]);
            setChartHiddenCCIds(new Set([2, 4]));
            w = mount(defineComponent({
                setup: () => () => [h(BattleSettings, { modelValue: true, target: null, self: null }), h(DContextMenu)],
            }), { attachTo: document.body });
            await gotoTab('DPS 圖表 CC');
        });

        it('splits the tracked CCs into timeline and coverage-only icons', () => {
            expect(icons('[data-on-chart]')).toEqual([1, 3]);
            expect(icons('[data-coverage-only]')).toEqual([2, 4]);
            expect(qa('[data-boss] .row')).toHaveLength(0);
        });

        it('the menu moves a timeline CC to coverage only, then removes it', async () => {
            rightClick(q('[data-boss] [data-on-chart] [data-cc="3"]'));
            await nextTick();
            expect(menu().map(m => [m.textContent?.trim(), m.getAttribute('aria-disabled') === 'true']))
                .toEqual([['時間軸與覆蓋率', true], ['僅覆蓋率', false], ['移除', false]]);
            item('僅覆蓋率').click();
            await nextTick();
            expect(icons('[data-coverage-only]')).toEqual([2, 3, 4]);
            rightClick(q('[data-boss] [data-coverage-only] [data-cc="3"]'));
            await nextTick();
            item('移除').click();
            await nextTick();
            expect(trackedCCIds.value).toEqual([1, 2, 4]);
        });

        it('the menu puts a coverage-only CC back on the timeline', async () => {
            rightClick(q('[data-boss] [data-coverage-only] [data-cc="2"]'));
            await nextTick();
            item('時間軸與覆蓋率').click();
            await nextTick();
            expect(icons('[data-on-chart]')).toEqual([1, 2, 3]);
        });

        it('candidates: click adds to the timeline, the menu can add coverage only', async () => {
            condNameMap.value = { 70: 'A', 71: 'B' };
            qa('[role="switch"], [role="checkbox"]').find(e => e.textContent?.includes('只顯示出現過'))!.click();
            await nextTick();
            q('[data-boss] .picker [data-cc="70"]').click();
            await nextTick();
            expect(icons('[data-on-chart]')).toEqual([1, 3, 70]);
            rightClick(q('[data-boss] .picker [data-cc="71"]'));
            await nextTick();
            item('僅覆蓋率').click();
            await nextTick();
            expect(icons('[data-coverage-only]')).toEqual([2, 4, 71]);
        });

        it('dragging reorders within a group and keeps the other group in place', async () => {
            const drag = (from: HTMLElement, to: HTMLElement) => {
                from.dispatchEvent(new Event('dragstart', { bubbles: true }));
                to.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
                from.dispatchEvent(new Event('dragend', { bubbles: true }));
            };
            drag(q('[data-boss] [data-coverage-only] [data-cc="4"]'), q('[data-boss] [data-coverage-only] [data-cc="2"]'));
            await nextTick();
            expect(trackedCCIds.value).toEqual([1, 4, 3, 2]);
            // A drag from the other group does not move anything here.
            drag(q('[data-boss] [data-on-chart] [data-cc="3"]'), q('[data-boss] [data-coverage-only] [data-cc="2"]'));
            await nextTick();
            expect(trackedCCIds.value).toEqual([1, 4, 3, 2]);
        });

        it('the mode switch shows rows and is remembered', async () => {
            qa('[data-tab="dps"] [data-pick-mode] [role="radio"]').find(r => r.textContent?.trim() === '清單')!.click();
            await nextTick();
            expect(ccPickMode.value).toBe('list');
            expect(settingsStorage.getItem('ccPickMode')).toBe('list');
            expect(qa('[data-boss] .row')).toHaveLength(4);
        });
    });

    describe('skill tab', () => {
        it('unchecking a column hides it in the store', async () => {
            mountSettings();
            await gotoTab('技能圖表');
            expect(hiddenSkillColumns.value.has('critCount')).toBe(false);
            rowOf('爆擊次數').querySelector<HTMLElement>('[role="checkbox"]')!.click();
            await nextTick();
            expect(hiddenSkillColumns.value.has('critCount')).toBe(true);
        });

        it('row limit -3 becomes 0', async () => {
            mountSettings();
            await gotoTab('技能圖表');
            setSkillRowLimit(5);
            await nextTick();
            const input = q('[data-row-limit]') as HTMLInputElement;
            const field = input.matches('input') ? input : input.querySelector('input')!;
            expect(field.value).toBe('5');
            field.value = '-3';
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('blur'));
            await nextTick();
            expect(skillRowLimit.value).toBe(0);
        });

        it('shows the pet switch hint, the footnote, and reset restores defaults', async () => {
            mountSettings();
            await gotoTab('技能圖表');
            expect(q('[data-tab="skill"]').textContent).toContain('人偶一律計入，不受影響');
            expect(q('[data-tab="skill"]').textContent).toContain('命中次數、總傷害、DPS、佔比一律顯示。');
            rowOf('爆擊次數').querySelector<HTMLElement>('[role="checkbox"]')!.click();
            await nextTick();
            q('[data-reset-skill]').click();
            await nextTick();
            expect(hiddenSkillColumns.value.has('critCount')).toBe(false);
        });

        it('dragging reorders the saved column order', async () => {
            mountSettings();
            await gotoTab('技能圖表');
            const rows = qa('.row');
            const labels = rows.map(r => r.textContent!.trim());
            rows[2].dispatchEvent(new Event('dragstart', { bubbles: true }));
            rows[0].dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
            await nextTick();
            expect(qa('.row')[0].textContent!.trim()).toBe(labels[2]);
        });
    });

    it('技能圖表 CC tab renders the coverage editor', async () => {
        mountSettings();
        await gotoTab('技能圖表 CC');
        expect(q('[data-tab="skillcc"]')).toBeTruthy();
        expect(qa('[data-nav]').length).toBe(11);
        expect(q('.d-dialog').classList.contains('fill')).toBe(true);
        await gotoTab('技能圖表');
        expect(q('.d-dialog').classList.contains('fill')).toBe(false);
    });

    describe('一般 tab: CCs and targets', () => {
        it('hidden monsters: empty text, add by RaceID, delete', async () => {
            setHiddenTargetRaces(new Set());
            mountSettings();
            expect(q('[data-tab="general"]').textContent).toContain('目前沒有隱藏怪物');
            const input = qa('input[placeholder^="搜尋種族"]')[1] as HTMLInputElement;
            input.value = '123456';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await nextTick();
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await nextTick();
            expect([...hiddenTargetRaces.value]).toEqual([123456]);
            expect(qa('[data-hidden-race-row]').map(r => r.textContent?.trim())).toEqual(['RaceID 123456']);
            qa('[data-hidden-race-row] button')[0].click();
            await nextTick();
            expect(hiddenTargetRaces.value.size).toBe(0);
        });


        it('typing a bare RaceID and pressing Enter adds it; reset appears and restores', async () => {
            mountSettings();
            const input = q('input[placeholder^="搜尋種族"]') as HTMLInputElement;
            input.value = '777777';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await nextTick();
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            await nextTick();
            expect(bossRaceIds.value.has(777777)).toBe(true);
            expect(qa('[data-boss-row]').some(r => r.textContent?.includes('RaceID 777777'))).toBe(true);
            q('[data-reset-boss]').click();
            await nextTick();
            expect(bossRaceIds.value.has(777777)).toBe(false);
        });

        it('boss rows delete, and picking from the race table adds', async () => {
            raceNameMap.value = { 555: '測試王 555' };
            mountSettings();
            qa('[data-boss-row] button')[0].click();
            await nextTick();
            expect(bossRaceIds.value.has(4856)).toBe(false);
            const input = q('input[placeholder^="搜尋種族"]') as HTMLInputElement;
            input.value = '測試';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            await nextTick();
            document.querySelector<HTMLElement>('[role="option"]')!.click();
            await nextTick();
            expect(bossRaceIds.value.has(555)).toBe(true);
        });
    });
});

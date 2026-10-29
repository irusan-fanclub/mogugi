// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { nextTick } from 'vue';
import { resetSettingsForTest } from '@/lib/settingsStorage';
import { mount, VueWrapper } from '@vue/test-utils';
import SkillCcSettings from './SkillCcSettings.vue';
import { setSkillCcList, skillCcModel } from './skillCcSettings';
import { setCcPickMode } from './ccPickMode';
import { condNameMap } from '@/store';
import type { SkillCcSeen } from '@/lib/skillCcSeen';

let w: VueWrapper | null = null;
beforeEach(() => {
    resetSettingsForTest();
    setCcPickMode('icon');
    setSkillCcList('common', 'boss', [494, 803]);
    setSkillCcList('common', 'self', [516]);
    setSkillCcList(1, 'self', [323]);
    setSkillCcList(1, 'boss', []);
    setSkillCcList(7, 'self', [1122]);
    condNameMap.value = { 323: '傷害詛咒 2', 700: '元素充能', 701: '屬性強化', 516: '覺醒', 494: '王技', 803: '甲', 900: '戰場狀態' };
});
afterEach(() => { w?.unmount(); w = null; document.body.innerHTML = ''; });

const seen: SkillCcSeen = {
    boss: new Set([900]),
    common: new Set([516, 700]),
    arcana: { 1: new Map([[700, 2], [701, 1]]) },
};
const mountIt = () => (w = mount(SkillCcSettings, { props: { seen }, attachTo: document.body }));
const q = (sel: string) => document.querySelector<HTMLElement>(sel)!;
const qa = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
const pick = async (text: string) => {
    qa('[data-nav]').find(e => e.textContent?.includes(text))!.click();
    await nextTick();
};
const sectionOf = (kind: 'boss' | 'self') => q(`[data-section="${kind}"]`);
const rowOf = (kind: 'boss' | 'self', text: string) =>
    Array.from(sectionOf(kind).querySelectorAll<HTMLElement>('.row')).find(r => r.textContent?.includes(text))!;
const cands = () => qa('.cc-btn');
const candTitles = () => cands().map(c => c.getAttribute('title')!);
const input = async (v: string) => {
    const i = q('input[placeholder^="搜尋 CC"]') as HTMLInputElement;
    i.value = v;
    i.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
};
const toggleSeen = async () => {
    qa('[role="switch"], [role="checkbox"]').find(e => e.textContent?.includes('只顯示這場出現過'))!.click();
    await nextTick();
};
const target = async (label: string) => {
    qa('[role="radio"]').find(e => e.textContent?.trim() === label)!.click();
    await nextTick();
};

describe('SkillCcSettings', () => {
    it('left column: 通用 first, then every arcana with boss+self counts', () => {
        mountIt();
        const names = qa('[data-nav]').map(e => e.textContent!.trim());
        expect(names).toHaveLength(11);
        expect(names[0]).toContain('通用');
        expect(names[0]).toContain('3');
        expect(names[1]).toContain('元素騎士');
        expect(names[1]).toContain('1');
        expect(names[10]).toContain('狂怒鬥士');
    });

    it('selecting 元素騎士 shows 自身 323, and BOSS is empty', async () => {
        mountIt();
        await pick('元素騎士');
        expect(rowOf('self', '323').textContent).toContain('傷害詛咒');
        expect(sectionOf('boss').querySelectorAll('.row')).toHaveLength(0);
    });

    it('通用 shows both sections', () => {
        mountIt();
        expect(rowOf('boss', '494')).toBeTruthy();
        expect(rowOf('self', '516')).toBeTruthy();
    });

    it('remove calls the setter for that section only', async () => {
        mountIt();
        await pick('元素騎士');
        rowOf('self', '323').querySelector<HTMLElement>('[data-remove] button')!.click();
        await nextTick();
        expect(skillCcModel.value.arcana[1].self).toEqual([]);
        expect(skillCcModel.value.arcana[7].self).toEqual([1122]);
        expect(skillCcModel.value.common.self).toEqual([516]);
        expect(skillCcModel.value.common.boss).toEqual([494, 803]);
    });

    it('grid adds to the section picked by the 加到 switch', async () => {
        mountIt();
        // default target is BOSS: seen on targets
        expect(candTitles()).toEqual(['戰場狀態 900']);
        cands()[0].click();
        await nextTick();
        expect(skillCcModel.value.common.boss).toEqual([494, 803, 900]);
        await target('自身');
        expect(candTitles()).toEqual(['元素充能 700']);
        cands()[0].click();
        await nextTick();
        expect(skillCcModel.value.common.self).toEqual([516, 700]);
        expect(skillCcModel.value.common.boss).toEqual([494, 803, 900]);
    });

    it('arcana 自身 candidates carry the player count in the title and survive add and search', async () => {
        mountIt();
        await pick('元素騎士');
        await target('自身');
        expect(candTitles()).toEqual([
            expect.stringContaining('出現在 2 位元素騎士'),
            expect.stringContaining('出現在 1 位元素騎士'),
        ]);
        cands()[0].click();
        await nextTick();
        expect(skillCcModel.value.arcana[1].self).toEqual([323, 700]);
        expect(cands()).toHaveLength(1);
        await input('屬性');
        expect(cands()).toHaveLength(1);
        await input('');
        expect(cands()).toHaveLength(1);
    });

    it('只顯示這場出現過 filters candidates and can be turned off', async () => {
        mountIt();
        await target('自身');
        expect(candTitles()).toEqual([expect.stringContaining('700')]);
        await toggleSeen();
        expect(cands().length).toBeGreaterThan(1);
        await input('覺醒');
        expect(cands()).toHaveLength(0);
        await input('戰場');
        expect(cands()).toHaveLength(1);
    });

    it('清單 shows the candidates as named rows that add on click', async () => {
        mountIt();
        await target('清單');
        expect(cands()).toHaveLength(0);
        const rows = qa('[data-skill-add]');
        expect(rows.map(r => r.textContent!.trim())).toEqual(['戰場狀態 900']);
        rows[0].click();
        await nextTick();
        expect(skillCcModel.value.common.boss).toEqual([494, 803, 900]);
    });

    it('reorder works inside a section', async () => {
        mountIt();
        const rows = Array.from(sectionOf('boss').querySelectorAll<HTMLElement>('.row'));
        rows[1].dispatchEvent(new Event('dragstart', { bubbles: true }));
        rows[0].dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }));
        await nextTick();
        expect(skillCcModel.value.common.boss).toEqual([803, 494]);
    });

    it('reset restores defaults for that kind only', async () => {
        mountIt();
        setSkillCcList(1, 'self', []);
        setSkillCcList(1, 'boss', [494]);
        await pick('元素騎士');
        sectionOf('self').querySelector<HTMLElement>('[data-reset]')!.click();
        await nextTick();
        expect(skillCcModel.value.arcana[1].self).toEqual([10020]);
        expect(skillCcModel.value.arcana[1].boss).toEqual([494]);
    });

    it('never mentions 王的 CC', () => {
        mountIt();
        expect(document.body.textContent).not.toContain('王的 CC');
        expect(document.body.textContent).toContain('BOSS');
        expect(document.body.textContent).toContain('自身');
    });
});

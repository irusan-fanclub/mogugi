// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';
import EquipmentTab from './EquipmentTab.vue';
import DContextMenu from '../../ui/DContextMenu.vue';
import { useContextMenu } from '../../ui/useContextMenu';
import { db, itemNameMap, ownerEquipment, ownerStats } from '@/store';
import { loadManual, saveManual, defaultManual } from '@/lib/musicAnalysis';
import { resetSettingsForTest, settingsStorage } from '@/lib/settingsStorage';

const worn = (pocket: number, id: number, over: Record<string, unknown> = {}) =>
    ({ pocket, eid: pocket, item: { id, defense: 7, protection: 3, ...over } }) as never;
const panel = (over: Record<string, unknown> = {}) => ({
    level: 10, combatPower: 1, abilityPoints: 0, life: 1, lifeMax: 2, mana: 1, manaMax: 2, stamina: 1, staminaMax: 2,
    str: 5, strMod: 3, dex: 0, dexMod: 0, int: 0, intMod: 0, will: 0, willMod: 0, luck: 0, luckMod: 0,
    attackMin: 0, attackMax: 0, offAttackMin: 0, offAttackMax: 0, injuryMin: 0, injuryMax: 0, critical: 0, balance: 0,
    defenseMod: 0, protectionMod: 0, magicAttackMod: 0, magicDefenseMod: 0, magicProtectionMod: 0, dualWield: false,
    ...over,
}) as never;

let w: VueWrapper | null = null;
function mountTab() {
    w = mount(defineComponent({ setup: () => () => [h(EquipmentTab), h(DContextMenu)] }), { attachTo: document.body });
}
beforeEach(() => {
    resetSettingsForTest();
    saveManual(defaultManual());
    vi.spyOn(db.value, 'getItemDescriptions').mockResolvedValue({});
    itemNameMap.value = { 1: '頭盔 1', 2: '長劍 2', 3: '短劍 3' };
});
afterEach(() => {
    useContextMenu().close(); w?.unmount(); w = null; document.body.innerHTML = '';
    ownerEquipment.value = []; ownerStats.value = null; vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const q = (s: string) => document.querySelector<HTMLElement>(s)!;
const qa = (s: string) => Array.from(document.querySelectorAll<HTMLElement>(s));
const slot = (pocket: number) => q(`[data-pocket="${pocket}"]`);
const menu = () => qa('[role="menuitem"]').map(e => e.textContent!.trim());
async function selectView(index: number) {
    q('[data-view] [role="combobox"]').click(); await nextTick();
    qa('[role="option"]')[index].click(); await nextTick();
}
const ev = () => new MouseEvent('contextmenu', { bubbles: true, cancelable: true });

describe('EquipmentTab', () => {
    it('shows the empty hint and "無" cells without a snapshot', () => {
        mountTab();
        expect(document.body.textContent).toContain('尚未收到角色快照');
        expect(slot(8).textContent).toContain('無');
        expect(document.body.textContent).toContain('尚未收到角色數值');
    });
    it('renders worn items with a brief line', () => {
        ownerEquipment.value = [worn(8, 1)];
        mountTab();
        expect(slot(8).textContent).toContain('頭盔');
        expect(slot(8).textContent).toContain('防禦 7 保護 3');
        expect(document.body.textContent).not.toContain('尚未收到角色快照');
    });
    it('freezes when auto-update is off; refresh pulls the current store; key kept', async () => {
        ownerEquipment.value = [worn(8, 1)];
        mountTab();
        q('[role="switch"]').click(); await nextTick();
        expect(settingsStorage.getItem('equipmentAutoFetch')).toBe('false');
        ownerEquipment.value = [worn(8, 2)]; await nextTick();
        expect(slot(8).textContent).toContain('頭盔');
        expect(q('[data-refresh]').hasAttribute('disabled')).toBe(false);
        q('[data-refresh]').click(); await nextTick();
        expect(slot(8).textContent).toContain('長劍');
    });
    it('starts frozen on an empty snapshot when auto-update is stored off', () => {
        settingsStorage.setItem('equipmentAutoFetch', 'false');
        ownerEquipment.value = [worn(8, 1)];
        mountTab();
        expect(slot(8).textContent).toContain('無');
    });
    it('weapon I/II toggle switches the left weapon pocket (10 -> 11), not remembered', async () => {
        ownerEquipment.value = [worn(10, 2, { attackMin: 1, attackMax: 2 }), worn(11, 3)];
        mountTab();
        expect(slot(10).textContent).toContain('長劍');
        qa('[data-pocket="10"] [data-set]')[1].click(); await nextTick();
        expect(document.querySelector('[data-pocket="10"]')).toBeNull();
        expect(slot(11).textContent).toContain('短劍');
        w!.unmount(); document.body.innerHTML = '';
        mountTab();
        expect(document.querySelector('[data-pocket="10"]')).not.toBeNull();
    });
    it('view select lists the four analyses, and placeholders show 施工中', async () => {
        mountTab();
        q('[data-view] [role="combobox"]').click(); await nextTick();
        expect(qa('[role="option"]').map(o => o.textContent!.trim())).toEqual(
            ['素質', '音樂分析（施工中）', '元素騎士（施工中）', '幻變槍手（施工中）']);
        qa('[role="option"]')[2].click(); await nextTick();
        expect(document.body.textContent).toContain('施工中，下一版提供。');
    });
    it('stats: base-unknown warning when level is missing', () => {
        ownerStats.value = panel({ level: 0 });
        mountTab();
        expect(document.body.textContent).toContain('基礎值未知');
        expect(qa('[data-prow]').length).toBeGreaterThan(10);
    });
    it('contribution table: red diff only when the diff is not zero', () => {
        ownerEquipment.value = [worn(8, 1)];
        // defense: sum 7 == server 7 (zero diff); strMod: sum 0 vs server 3 (non-zero).
        ownerStats.value = panel({ strMod: 3, defenseMod: 7 });
        mountTab();
        const rows = qa('[data-crow]');
        const diffCell = (label: string) =>
            rows.find(r => r.querySelector('td')!.textContent === label)!.querySelector('[data-diff]')!;
        expect(diffCell('力量').classList.contains('diff')).toBe(true);
        expect(diffCell('力量').textContent!.trim()).toBe('3');
        expect(diffCell('防禦力').classList.contains('diff')).toBe(false);
        expect(diffCell('防禦力').textContent!.trim()).toBe('');
        expect(qa('[data-contrib] thead th')[1].textContent).toContain('頭');
    });
    it('slot context menu copies name, id and tooltip text; weapon cell also toggles I/II', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        ownerEquipment.value = [worn(8, 1), worn(10, 2, { attackMin: 1, attackMax: 2 })];
        mountTab();
        slot(8).dispatchEvent(ev()); await nextTick();
        expect(menu()).toEqual(['複製物品名', '複製物品 ID', '複製提示文字']);
        qa('[role="menuitem"]')[1].click(); await nextTick();
        expect(writeText).toHaveBeenCalledWith('1');
        slot(10).dispatchEvent(ev()); await nextTick();
        expect(menu()).toEqual(['複製物品名', '複製物品 ID', '複製提示文字', '切換 I／II']);
        qa('[role="menuitem"]')[3].click(); await nextTick();
        expect(document.querySelector('[data-pocket="11"]')).not.toBeNull();
    });
    it('panel row context menu copies "label value"', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        ownerStats.value = panel();
        mountTab();
        const row = qa('[data-prow]').find(r => r.textContent!.includes('力量'))!;
        row.dispatchEvent(ev()); await nextTick();
        qa('[role="menuitem"]')[0].click(); await nextTick();
        expect(writeText).toHaveBeenCalledWith('力量 5 + 3');
    });
    it('music view renders the analysis and keeps the manual input for the session', async () => {
        mountTab();
        await selectView(1);
        expect(qa('[data-song]').length).toBeGreaterThan(0);
        expect(document.body.textContent).toContain('普洛貓 !music');
        // Open the title group and type into the first manual number field.
        qa('.grp-hd').find(b => b.textContent!.includes('角色稱號效果'))!.click(); await nextTick();
        const field = qa('[data-num]').find(e => e.closest('[data-group]')!.textContent!.includes('角色稱號效果'))!;
        const input = (field.tagName === 'INPUT' ? field : field.querySelector('input')) as HTMLInputElement;
        input.value = '8'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('blur')); await nextTick();
        expect(loadManual().titleBattle).toBe(8);
    });
    it('music reset clears manual input back to defaults', async () => {
        saveManual({ ...defaultManual(), titleBattle: 8, arcana: true });
        mountTab();
        await selectView(1);
        q('[data-reset]').click(); await nextTick();
        const saved = loadManual();
        expect(saved.titleBattle).toBe(0);
        expect(saved.arcana).toBe(false);
    });
});

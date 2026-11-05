// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount, VueWrapper } from '@vue/test-utils';
import CharactersTab from './CharactersTab.vue';
import DContextMenu from '../../ui/DContextMenu.vue';
import { useContextMenu } from '../../ui/useContextMenu';
import { useToast } from '../../ui/useToast';
import { actorManager, itemNameMap, raceNameMap } from '@/store';
import { prilusUrl, noginogiUrl, buildStyle, encodeB64Url } from '@/lib/charSimul';
import { clearAllAliases, setAlias } from '@/lib/entityAlias';

const pc = (id: string, name: string, over: Record<string, unknown> = {}) => ({
    id, name, raceId: 8001, guildName: '公會' + name, isPC: true,
    body: { Height: 1, Weight: 1, Upper: 1, Lower: 1 },
    conditionMap: { 1: { CCId: 20 }, 2: { CCId: 10 } },
    equipItemMap: {
        1: { PocketType: 4, ItemId: 500, Color1: '#10000095', Color2: '#fffcf3e4', Color3: '#000000', Color5: '#112233', Color6: '#112233', Color7: '#112233' },
        2: { PocketType: 15, ItemId: 501, Color1: '#abcdef', Color2: '#000000', Color3: '#000000', Color5: '#000000', Color6: '#000000', Color7: '#000000' },
        3: { PocketType: 3, ItemId: 502, Color1: '#000000', Color2: '#000000', Color3: '#000000', Color5: '#000000', Color6: '#000000', Color7: '#000000' },
    },
    ...over,
});
const setActors = (...a: unknown[]) => {
    const m = actorManager.value.entityMap as Record<string, unknown>;
    for (const k of Object.keys(m)) delete m[k];
    for (const x of a as { id: string }[]) m[x.id] = x;
};
let w: VueWrapper | null = null;
function mountTab() {
    w = mount(defineComponent({ setup: () => () => [h(CharactersTab), h(DContextMenu)] }), { attachTo: document.body });
}
afterEach(() => {
    useContextMenu().close(); w?.unmount(); w = null; document.body.innerHTML = '';
    setActors(); clearAllAliases(); vi.unstubAllGlobals();
});
const names = () => Array.from(document.querySelectorAll('[data-pc] .pname')).map(e => e.textContent);
const menu = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
const ev = () => new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
const expand = async () => { document.querySelector<HTMLElement>('.hd')!.click(); await nextTick(); };

describe('CharactersTab', () => {
    it('lists PCs sorted by name and skips non-PCs', () => {
        setActors(pc('1', '乙'), pc('2', '甲'), pc('3', '怪', { isPC: false }));
        mountTab();
        expect(names()).toEqual(['乙', '甲'].sort((a, b) => a.localeCompare(b)));
    });
    it('expands in place: slot names in display order, unknown pocket fallback, body ratios, race and guild', async () => {
        raceNameMap.value = { 8001: '人類 8001' }; itemNameMap.value = { 500: '髮 500', 501: '謎 501', 502: '臉 502' };
        setActors(pc('1', '甲'));
        mountTab();
        expect(document.querySelectorAll('[data-equip]')).toHaveLength(0);
        await expand();
        const rows = Array.from(document.querySelectorAll('[data-equip]'));
        expect(rows.map(r => r.querySelector('.eq-slot')!.textContent)).toEqual(['臉型', '髮型', '欄位 15']);
        expect(rows.map(r => r.querySelector('.eq-name')!.textContent)).toEqual(['臉', '髮', '謎']);
        expect(document.querySelector('.body-ratio')!.textContent).toBe('h: 1.00 w: 1.00 u: 1.00 l: 1.00');
        expect(document.querySelector('.hd')!.textContent).toContain('人類');
        expect(document.querySelector('.hd')!.textContent).toContain('公會甲');
    });
    it('rows have no icon and no status block', async () => {
        setActors(pc('1', '甲'));
        mountTab();
        await expand();
        expect(document.querySelector('img.ico')).toBeNull();
        expect(document.querySelector('img')).toBeNull();
        expect(document.querySelector('[data-cc]')).toBeNull();
        expect(document.querySelector('.conds')).toBeNull();
    });
    it('reserves 7em for the name', () => {
        setActors(pc('1', '甲'));
        mountTab();
        const n = document.querySelector<HTMLElement>('.pname')!;
        expect(n.style.width).toBe('7em');
        expect([n.style.flexGrow, n.style.flexShrink]).toEqual(['0', '0']);
    });
    it('shows colour codes without alpha and copies one on click', async () => {
        const writeText = vi.fn(async () => {});
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        setActors(pc('1', '甲'));
        mountTab();
        await expand();
        const hair = document.querySelectorAll('[data-equip]')[1];
        const chips = Array.from(hair.querySelectorAll<HTMLElement>('[data-chip]'));
        expect(chips.map(c => c.textContent!.trim())).toEqual(['#000095', '#fcf3e4', '#000000', '#112233', '#112233', '#112233']);
        expect(chips[1].title).toBe('#fffcf3e4');
        chips[1].click();
        await nextTick();
        expect(writeText).toHaveBeenLastCalledWith('#fcf3e4');
        expect(useToast().items.map(t => t.text)).toContain('已複製 #fcf3e4');
    });
    it('the simulator button opens a menu with copy, Prilus and noginogi', async () => {
        const writeText = vi.fn(async () => {});
        const open = vi.fn();
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        vi.stubGlobal('open', open);
        setActors(pc('1', '甲'));
        mountTab();
        document.querySelector<HTMLElement>('[aria-label="角色模擬"]')!.click();
        await nextTick();
        expect(document.querySelector('[data-body]')).toBeNull(); // did not toggle the row
        expect(menu().map(m => m.textContent!.trim())).toEqual(['複製模擬代碼', '在 Prilus 開啟', '在 noginogi 開啟']);
        const actor = actorManager.value.entityMap['1'] as never;
        const style = buildStyle(actor);
        menu()[0].click();
        await nextTick();
        expect(writeText).toHaveBeenLastCalledWith(encodeB64Url({ name: '甲', style }));
        document.querySelector<HTMLElement>('[aria-label="角色模擬"]')!.click();
        await nextTick();
        menu()[1].click();
        expect(open).toHaveBeenLastCalledWith(prilusUrl(style), '_blank', 'noopener');
        document.querySelector<HTMLElement>('[aria-label="角色模擬"]')!.click();
        await nextTick();
        menu()[2].click();
        expect(open).toHaveBeenLastCalledWith(noginogiUrl('甲', style), '_blank', 'noopener');
    });
    it('shows the real name and has no rename or random-name buttons, even with a battle alias', () => {
        setActors(pc('1', '甲'));
        setAlias('甲', '小明');
        mountTab();
        expect(names()).toEqual(['甲']);
        expect(document.querySelector('[aria-label="改名"]')).toBeNull();
        expect(document.querySelector('[aria-label="隨機別名"]')).toBeNull();
    });
    it('puts the simulator button right after the name', () => {
        setActors(pc('1', '甲'));
        mountTab();
        const next = document.querySelector('.pname')!.nextElementSibling!;
        expect(next.matches('[aria-label="角色模擬"]') || next.querySelector('[aria-label="角色模擬"]') !== null).toBe(true);
    });
    describe('search', () => {
        const search = async (q: string) => {
            const i = document.querySelector<HTMLInputElement>('input[placeholder="搜尋角色名、公會、種族或裝備"]')!;
            i.value = q;
            i.dispatchEvent(new Event('input'));
            await nextTick();
        };
        const setup = () => {
            raceNameMap.value = { 8001: '人類 8001', 8002: '精靈 8002' };
            itemNameMap.value = { 500: '長劍 500', 501: '盾 501', 503: '法杖 503', 502: '臉 502' };
            setActors(
                pc('1', 'Alice'),
                pc('2', 'Bob', { guildName: 'Knights', raceId: 8002, equipItemMap: { 1: { PocketType: 4, ItemId: 503 } } }),
                pc('3', 'Carol', { equipItemMap: { 1: { PocketType: 4, ItemId: 500 } } }),
            );
            mountTab();
        };
        it('matches name case-insensitively and trims', async () => {
            setup();
            await search('  aLIc ');
            expect(names()).toEqual(['Alice']);
        });
        it('matches guild and race', async () => {
            setup();
            await search('knight');
            expect(names()).toEqual(['Bob']);
            await search('精靈');
            expect(names()).toEqual(['Bob']);
        });
        it('matches equipped item names without expanding rows', async () => {
            setup();
            await search('法杖');
            expect(names()).toEqual(['Bob']);
            expect(document.querySelector('[data-body]')).toBeNull();
        });
        it('shows count while filtering and the no-match message', async () => {
            setup();
            expect(document.querySelector('[data-count]')).toBeNull();
            await search('bob');
            expect(document.querySelector('[data-count]')!.textContent).toBe('1／3');
            await search('zzz');
            expect(document.querySelector('.empty')!.textContent).toBe('找不到符合的角色');
            await search('');
            expect(names()).toHaveLength(3);
        });
        it('keeps the no-data message when there are no PCs', () => {
            setActors();
            mountTab();
            expect(document.querySelector('.empty')!.textContent).toBe('尚無角色資料');
        });
    });
    it('context menus copy names and ids', async () => {
        const writeText = vi.fn(async () => {});
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        raceNameMap.value = { 8001: '人類 8001' }; itemNameMap.value = { 500: '劍 500' };
        setActors(pc('1', '甲'));
        mountTab();
        document.querySelector<HTMLElement>('.hd')!.dispatchEvent(ev());
        await nextTick();
        expect(menu().map(m => m.textContent!.trim())).toEqual(['複製角色名', '複製公會', '複製種族']);
        menu()[1].click();
        await nextTick();
        expect(writeText).toHaveBeenLastCalledWith('公會甲');
        await expand();
        document.querySelectorAll<HTMLElement>('[data-equip]')[1].dispatchEvent(ev()); // pocket 4
        await nextTick();
        expect(menu().map(m => m.textContent!.trim())).toEqual(['複製物品名', '複製物品 ID']);
        menu()[1].click();
        await nextTick();
        expect(writeText).toHaveBeenLastCalledWith('500');
    });
});

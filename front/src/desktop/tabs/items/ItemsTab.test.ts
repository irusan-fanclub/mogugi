// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';

const downloaded: { name: string; csv: string }[] = [];
vi.mock('@/lib/csvExport', async importOriginal => ({
    ...(await importOriginal<typeof import('@/lib/csvExport')>()),
    downloadCsv: (name: string, csv: string) => { downloaded.push({ name, csv }); },
}));

import ItemsTab from './ItemsTab.vue';
import { resetSettingsForTest, settingsStorage } from '@/lib/settingsStorage';
import DContextMenu from '../../ui/DContextMenu.vue';
import { useContextMenu } from '../../ui/useContextMenu';
import { LICENSE_GUARD_KEY, SESSION_KEY, TAB_SWITCH_KEY } from '../../session';
import { db, itemNameMap } from '@/store';
import type { IndexEntity } from '@/lib/itemIndex';

const mk = (id: number, o: object = {}) => ({ id, qty: 1, storage: 'inventory', container: 'inv', x: 0, y: 0, ...o });
const DATA: IndexEntity[] = [
    { entity: '甲', master: '主人', items: [mk(1, { attackMin: 1, attackMax: 5, qty: 3 }), mk(2, { storage: 'bank', qty: 10 })] },
    { entity: '乙', master: '主人', items: [mk(3, { qty: 2 }), mk(1, { storage: 'bank', qty: 7 })] },
];

const fetchMock = vi.fn();
let w: VueWrapper | null = null;

function mountTab() {
    const Host = defineComponent({ setup: () => () => [h(ItemsTab), h(DContextMenu)] });
    w = mount(Host, {
        attachTo: document.body,
        global: { provide: {
            [SESSION_KEY as symbol]: () => null,
            [LICENSE_GUARD_KEY as symbol]: () => false,
            [TAB_SWITCH_KEY as symbol]: () => {},
        } },
    });
}
const bodyRows = () => Array.from(document.querySelectorAll<HTMLElement>('[data-row]'));
const nameCol = () => bodyRows().map(r => r.querySelector('[data-cell="item"]')!.textContent!.trim());
const menuItems = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
const th = (key: string) => document.querySelector<HTMLElement>(`th[data-col="${key}"]`)!;
const rightClick = async (el: Element) => {
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
    await nextTick();
};

beforeEach(() => {
    itemNameMap.value = { 1: '長劍 1', 2: '藥水 2', 3: '盾牌 3' };
    vi.spyOn(db.value, 'getItemDescriptions').mockResolvedValue({});
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(DATA)));
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    useContextMenu().close();
    w?.unmount(); w = null;
    document.body.innerHTML = '';
    fetchMock.mockReset(); downloaded.length = 0;
    vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
    resetSettingsForTest();
});

describe('ItemsTab', () => {
    it('lists rows, counts entities and kinds, shows search error for a bad regex', async () => {
        mountTab();
        await flushPromises();
        expect(bodyRows()).toHaveLength(4);
        expect(document.querySelector('[data-count]')!.textContent).toContain('2 個實體 / 3 種物品');
        const input = document.querySelector<HTMLInputElement>('input[aria-label="搜尋"]')!;
        input.value = '/劍[/';
        input.dispatchEvent(new Event('input'));
        await flushPromises();
        expect(document.body.textContent).toContain('正則式無效');
        expect(bodyRows()).toHaveLength(0);
    });

    it('CSV export order equals the on-screen multi-key sort', async () => {
        mountTab();
        await flushPromises();
        // Entity desc (two clicks), then Shift+click stacks qty asc.
        th('entity').click(); th('entity').click();   // asc, desc
        await nextTick();
        th('qty').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
        await flushPromises();
        const screen = bodyRows().map(r => r.querySelector('[data-cell="qty"]')!.textContent!.trim());
        expect(screen).toEqual(['2', '7', '3', '10']);
        (document.querySelector('[data-export]') as HTMLElement).click();
        expect(downloaded).toHaveLength(1);
        expect(downloaded[0].name).toMatch(/^物品索引_\d{8}-\d{6}\.csv$/);
        const lines = downloaded[0].csv.split('\r\n').slice(1);
        const header = downloaded[0].csv.split('\r\n')[0].split(',');
        const q = header.indexOf('數量');
        expect(lines.map(l => l.split(',')[q])).toEqual(screen);
    });

    it('context menu 以此 ID 搜尋 fills the search box', async () => {
        mountTab();
        await flushPromises();
        const row = bodyRows().find(r => r.textContent!.includes('盾牌'))!;
        await rightClick(row);
        menuItems().find(i => i.textContent!.includes('以此 ID 搜尋'))!.click();
        await flushPromises();
        expect(document.querySelector<HTMLInputElement>('input[aria-label="搜尋"]')!.value).toBe('3');
        expect(nameCol()).toEqual(['盾牌']);
    });

    it('exclude via cell icon hides rows; chip removal restores', async () => {
        mountTab();
        await flushPromises();
        document.querySelector<HTMLElement>('[data-cell="entity"] [data-ex="entity"]')!.click();
        await flushPromises();
        expect(bodyRows()).toHaveLength(2);
        expect(document.querySelector('[data-excludes]')).not.toBeNull();
        document.querySelector<HTMLElement>('[data-exclude-remove]')!.click();
        await flushPromises();
        expect(bodyRows()).toHaveLength(4);
        expect(document.querySelector('[data-excludes]')).toBeNull();
    });

    it('chip context menu 移除排除 and 只看此角色', async () => {
        mountTab();
        await flushPromises();
        Array.from(document.querySelectorAll<HTMLElement>('[data-cell="storage"]'))
            .find(c => c.textContent!.includes('銀行'))!.querySelector<HTMLElement>('[data-ex="storage"]')!.click();
        await flushPromises();
        expect(bodyRows()).toHaveLength(2);
        await rightClick(document.querySelector('[data-exclude-chip]')!);
        menuItems().find(i => i.textContent!.includes('移除排除'))!.click();
        await flushPromises();
        expect(bodyRows()).toHaveLength(4);
        await rightClick(bodyRows()[0]);
        menuItems().find(i => i.textContent!.includes('只看此角色'))!.click();
        await flushPromises();
        expect(bodyRows()).toHaveLength(2);
    });

    it('column menu toggles columns and stores them', async () => {
        mountTab();
        await flushPromises();
        expect(th('metalware')).toBeNull();
        document.querySelector<HTMLElement>('button[aria-label="顯示欄位"], [title="顯示欄位"]')!.click();
        await nextTick();
        const opt = Array.from(document.querySelectorAll<HTMLElement>('[data-col-opt]')).find(o => o.textContent!.includes('細工'))!;
        opt.click();
        await flushPromises();
        expect(th('metalware')).not.toBeNull();
        expect(JSON.parse(settingsStorage.getItem('itemsColumns')!)).toContain('metalware');
    });

    it('pages 50 rows by default and shows the range', async () => {
        const many: IndexEntity[] = [{ entity: '甲', master: '', items: Array.from({ length: 120 }, (_, i) => mk(1000 + i)) }];
        fetchMock.mockImplementation(async () => new Response(JSON.stringify(many)));
        mountTab();
        await flushPromises();
        expect(bodyRows()).toHaveLength(50);
        expect(document.querySelector('[data-range]')!.textContent).toContain('1–50 / 120');
        document.querySelector<HTMLElement>('[data-next]')!.click();
        await flushPromises();
        expect(document.querySelector('[data-range]')!.textContent).toContain('51–100 / 120');
    });

    it('item name hover shows ItemTip after 150 ms', async () => {
        vi.useFakeTimers();
        mountTab();
        await vi.advanceTimersByTimeAsync(10);
        await flushPromises();
        const name = Array.from(document.querySelectorAll<HTMLElement>('[data-tip-name]')).find(n => n.textContent === '長劍')!;
        name.parentElement!.dispatchEvent(new MouseEvent('mouseenter'));
        await vi.advanceTimersByTimeAsync(100);
        expect(document.querySelector('.item-tip')).toBeNull();
        await vi.advanceTimersByTimeAsync(60);
        expect(document.querySelector('.item-tip')).not.toBeNull();
    });
});

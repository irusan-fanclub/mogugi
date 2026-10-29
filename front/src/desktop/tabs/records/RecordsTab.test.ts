// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import RecordsTab from './RecordsTab.vue';
import DContextMenu from '../../ui/DContextMenu.vue';
import { useContextMenu } from '../../ui/useContextMenu';
import { LICENSE_GUARD_KEY, SESSION_KEY, TAB_SWITCH_KEY } from '../../session';
import { LicenseRequiredError } from '@/lib/configApi';
import type { BattleRecord } from '@/lib/battleFilter';

const rec = (file: string, player: string, boss: string, t: number): BattleRecord => ({
    file, code: 'brileith', tier: '', player, startedAtLocal: '2026-10-21T10:00:00+08:00', sizeBytes: 1,
    fights: [{ stage: 's', bossRace: 1, bossName: boss, fightStartAt: t, fightEndAt: t + 60, durationSec: 60, cleared: true, partySize: 1, ownerDps: 1000, players: [] }],
});
const DATA = [rec('a.ndjson', '甲', 'Alpha', 100), rec('b.ndjson', '乙', 'Beta', 200), rec('c.ndjson', '甲', 'Beta', 300)];

const loadBattleRecord = vi.fn(async (_f: string) => {});
const switchTab = vi.fn();
const guardFn = vi.fn((_e: unknown) => false);
const fetchMock = vi.fn();
let w: VueWrapper | null = null;

function mountTab() {
    const Host = defineComponent({ setup: () => () => [h(RecordsTab), h(DContextMenu)] });
    w = mount(Host, {
        attachTo: document.body,
        global: { provide: {
            [SESSION_KEY as symbol]: () => ({ loadBattleRecord }),
            [LICENSE_GUARD_KEY as symbol]: guardFn,
            [TAB_SWITCH_KEY as symbol]: switchTab,
        } },
    });
}
const bodyRows = () => document.querySelectorAll('[data-row]');
const menuItems = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));

beforeEach(() => {
    fetchMock.mockImplementation(async (url: string) => {
        if (url === '/api/battles') return new Response(JSON.stringify({ battles: DATA }));
        return new Response('{}');
    });
    vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
    useContextMenu().close();
    w?.unmount(); w = null;
    document.body.innerHTML = '';
    fetchMock.mockReset(); loadBattleRecord.mockClear(); switchTab.mockClear(); guardFn.mockClear();
    vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('RecordsTab', () => {
    it('shows the total size of the filtered rows', async () => {
        mountTab();
        await flushPromises();
        expect(document.querySelector('[data-size]')!.textContent).toContain('檔案大小 3 B');
    });

    it('size and file count drop when a filter is applied', async () => {
        mountTab();
        await flushPromises();
        await document.querySelector<HTMLElement>('[aria-label="角色"] [data-select-box]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await nextTick();
        Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(o => o.textContent?.includes('乙'))!.click();
        await flushPromises();
        const t = document.querySelector('[data-count]')!.textContent!;
        expect(document.querySelector('[data-size]')!.textContent).toContain('檔案大小 1 B');
        expect(t).toContain('1個檔案');
    });

    it('shows the version labels and filters rows by a bound', async () => {
        const withClient = DATA.map((r, i) => ({ ...r, client: ['tw100', 'tw150', 'tw169'][i] }));
        fetchMock.mockImplementation(async () => new Response(JSON.stringify({ battles: withClient })));
        mountTab();
        await flushPromises();
        const text = document.body.textContent!;
        expect(text).toContain('版本從');
        expect(text).toContain('版本到');
        expect(bodyRows()).toHaveLength(3);
        await document.querySelector<HTMLElement>('[aria-label="版本從"] [data-select-box]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await nextTick();
        Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(o => o.textContent?.trim() === 'tw150')!.click();
        await flushPromises();
        expect(bodyRows()).toHaveLength(2);
        expect(document.querySelector('[data-count]')!.textContent).toContain('2場戰鬥');
    });

    it('lists rows and filters by BOSS through the select', async () => {
        mountTab();
        await flushPromises();
        expect(bodyRows()).toHaveLength(3);
        expect(document.querySelector('[data-count]')!.textContent).toContain('3場戰鬥');
        await document.querySelector<HTMLElement>('[aria-label="BOSS 名稱"] [data-select-box]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await nextTick();
        const opt = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(o => o.textContent?.includes('Beta'))!;
        opt.click();
        await flushPromises();
        expect(bodyRows()).toHaveLength(2);
        expect(document.querySelector('[data-count]')!.textContent).toContain('2場戰鬥');
    });

    it('right-aligns the activeDps cells like dps', async () => {
        mountTab();
        await flushPromises();
        expect(document.querySelector('td[data-cell="activeDps"]')!.classList.contains('right')).toBe(true);
        expect(document.querySelector('td[data-cell="dps"]')!.classList.contains('right')).toBe(true);
    });

    it('context menu 只看這個角色 sets the player filter', async () => {
        mountTab();
        await flushPromises();
        bodyRows()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }));
        await nextTick();
        // Newest first: c.ndjson (甲, Beta).
        menuItems().find(i => i.textContent?.includes('只看這個角色'))!.click();
        await flushPromises();
        expect(bodyRows()).toHaveLength(2);
        expect(document.querySelector('[aria-label="角色"]')!.textContent).toContain('甲');
    });

    it('delete needs two clicks; the first does not call the API', async () => {
        mountTab();
        await flushPromises();
        const del = () => document.querySelectorAll<HTMLElement>('[data-row]')[0];
        const firstBtn = () => del().querySelector<HTMLElement>('[data-act="delete"]')!;
        firstBtn().click();
        await flushPromises();
        expect(fetchMock.mock.calls.some(c => String(c[0]).startsWith('/api/battles/delete'))).toBe(false);
        del().querySelector<HTMLElement>('[data-act="confirm-delete"]')!.click();
        await flushPromises();
        const call = fetchMock.mock.calls.find(c => String(c[0]).startsWith('/api/battles/delete'))!;
        expect(call[0]).toBe('/api/battles/delete?file=c.ndjson');
        expect(call[1].method).toBe('POST');
        expect(bodyRows()).toHaveLength(2);
    });

    it('armed delete lapses after 4 seconds', async () => {
        vi.useFakeTimers();
        mountTab();
        await vi.advanceTimersByTimeAsync(10);
        document.querySelector<HTMLElement>('[data-act="delete"]')!.click();
        await nextTick();
        expect(document.querySelector('[data-act="confirm-delete"]')).not.toBeNull();
        await vi.advanceTimersByTimeAsync(4100);
        expect(document.querySelector('[data-act="confirm-delete"]')).toBeNull();
    });

    it('load button loads the record and switches to the battle tab', async () => {
        mountTab();
        await flushPromises();
        document.querySelector<HTMLElement>('[data-act="load"]')!.click();
        await flushPromises();
        expect(loadBattleRecord).toHaveBeenCalledWith('c.ndjson');
        expect(switchTab).toHaveBeenCalledWith('battle');
    });

    it('only startedAt, duration and dps headers sort; first click is desc', async () => {
        mountTab();
        await flushPromises();
        const sortable = Array.from(document.querySelectorAll('th.sortable')).map(t => (t as HTMLElement).dataset.col);
        expect(sortable).toEqual(['startedAt', 'duration', 'dps']);
        document.querySelector<HTMLElement>('th[data-col="dps"]')!.click();
        await nextTick();
        expect(document.querySelector('th[data-col="dps"]')!.getAttribute('aria-sort')).toBe('descending');
    });

    it('saves a note via POST /api/battles/note', async () => {
        mountTab();
        await flushPromises();
        document.querySelector<HTMLElement>('[data-act="expand"]')!.click();
        await nextTick();
        const ta = document.querySelector<HTMLTextAreaElement>('[data-expanded] textarea')!;
        ta.value = '備註';
        ta.dispatchEvent(new Event('input'));
        await nextTick();
        document.querySelector<HTMLElement>('[data-save-note]')!.click();
        await flushPromises();
        const call = fetchMock.mock.calls.find(c => String(c[0]).startsWith('/api/battles/note'))!;
        expect(JSON.parse(call[1].body)).toEqual({ note: '備註' });
    });

    it('shows the empty text when there are no battles', async () => {
        fetchMock.mockImplementation(async () => new Response(JSON.stringify({ battles: [] })));
        mountTab();
        await flushPromises();
        expect(document.querySelector('[data-empty]')!.textContent).toContain('目前沒有戰鬥紀錄');
    });

    it('a 403 while loading a record reaches the license guard and does not switch tabs', async () => {
        loadBattleRecord.mockRejectedValueOnce(new LicenseRequiredError());
        guardFn.mockReturnValueOnce(true);
        mountTab();
        await flushPromises();
        document.querySelector<HTMLElement>('[data-act="load"]')!.click();
        await flushPromises();
        expect(guardFn).toHaveBeenCalledTimes(1);
        expect(guardFn.mock.calls[0][0]).toBeInstanceOf(LicenseRequiredError);
        expect(switchTab).not.toHaveBeenCalled();
    });

    it('paginator follows the clamped page after filtering down', async () => {
        const many = Array.from({ length: 5 }, (_, i) => rec(`f${i}.ndjson`, i === 0 ? '乙' : '甲', 'Alpha', 100 + i));
        fetchMock.mockImplementation(async () => new Response(JSON.stringify({ battles: many })));
        mountTab();
        await flushPromises();
        // 2 rows per page -> 3 pages; go to page 3.
        const size = document.querySelector<HTMLInputElement>('[aria-label="顯示列數"] input')!;
        size.value = '2';
        size.dispatchEvent(new Event('input'));
        size.dispatchEvent(new Event('blur'));
        await flushPromises();
        const pages = () => Array.from(document.querySelectorAll('[data-page]')).map(b => b.textContent);
        expect(pages()).toEqual(['1', '2', '3']);
        (document.querySelectorAll('[data-page]')[2] as HTMLElement).click();
        await flushPromises();
        expect(bodyRows()).toHaveLength(1);
        // Filter to 乙: one row, one page.
        bodyRows()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await nextTick();
        menuItems().find(i => i.textContent?.includes('只看這個角色'))!.click();
        await flushPromises();
        expect(bodyRows()).toHaveLength(1);
        expect(document.querySelector('[data-page]')).toBeNull();
    });
});

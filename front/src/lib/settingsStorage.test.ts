// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { flushSettings, hydrateSettings, loadSetting, resetSettingsForTest, saveSetting, settingsStorage } from './settingsStorage';

type Call = { url: string; init?: RequestInit };
let calls: Call[] = [];
function stubFetch(body: Record<string, unknown> | null, status = 200) {
    calls = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        if (init?.method === 'PUT') return new Response(null, { status: 204 });
        return new Response(JSON.stringify(body), { status });
    }));
}
const puts = () => calls.filter(c => c.init?.method === 'PUT').map(c => JSON.parse(String(c.init!.body)));
const isNum = (v: unknown): v is number => typeof v === 'number';

beforeEach(() => { resetSettingsForTest(); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); resetSettingsForTest(); });

describe('settingsStorage', () => {
    it('unhydrated keeps values in memory and never fetches or saves', async () => {
        stubFetch({});
        settingsStorage.setItem('trackedDebuffCCIds', '[1]');
        saveSetting('recordsColumns', { a: 1 });
        expect(settingsStorage.getItem('trackedDebuffCCIds')).toBe('[1]');
        expect(loadSetting('recordsColumns', null, (v): v is object => typeof v === 'object')).toEqual({ a: 1 });
        await flushSettings();
        expect(calls).toEqual([]);
    });

    it('hydrate reads the battle and ui tables', async () => {
        stubFetch({
            battle: { bossCC: [803, 1026], ccPickMode: 'list', general: { hpGuideStep: 10 } },
            ui: { equipmentAutoFetch: false, itemsColumns: ['a'] },
        });
        await hydrateSettings();
        expect(settingsStorage.getItem('trackedDebuffCCIds')).toBe('[803,1026]');
        expect(settingsStorage.getItem('ccPickMode')).toBe('list');
        expect(JSON.parse(settingsStorage.getItem('config')!).hpGuideStep).toBe(10);
        expect(settingsStorage.getItem('chartHiddenCCIds')).toBeNull();
        expect(settingsStorage.getItem('equipmentAutoFetch')).toBe('false');
        expect(loadSetting('itemsColumns', [], Array.isArray)).toEqual(['a']);
        expect(puts()).toEqual([]);
    });

    it('batches writes into one PUT with only the changed sections', async () => {
        stubFetch({ battle: { bossCC: [1] }, ui: { importBattles: true } });
        await hydrateSettings();
        vi.useFakeTimers();
        settingsStorage.setItem('trackedDebuffCCIds', '[2]');
        settingsStorage.setItem('chartHiddenCCIds', '[2]');
        settingsStorage.removeItem('trackedDebuffCCIds');
        expect(puts()).toEqual([]);
        await vi.advanceTimersByTimeAsync(400);
        expect(puts()).toEqual([{ battle: { bossCoverageOnly: [2] } }]);
    });

    it('drops names no entry uses and saves the cleaned table', async () => {
        stubFetch({ battle: { bossCC: [1], legend: {}, migratedX: '1' }, ui: { importBattles: true } });
        await hydrateSettings();
        await flushSettings();
        expect(puts()).toEqual([{ battle: { bossCC: [1] } }]);
    });

    it('a ui change PUTs only the ui table', async () => {
        stubFetch({ battle: { bossCC: [1] }, ui: {} });
        await hydrateSettings();
        saveSetting('importBattles', true);
        await flushSettings();
        expect(puts()).toEqual([{ ui: { importBattles: true } }]);
    });

    it('read-only (overlay windows) reads the tables but never saves', async () => {
        stubFetch({ battle: { general: { bossRaceAdded: [7] } }, ui: {} });
        await hydrateSettings({ readOnly: true });
        expect(JSON.parse(settingsStorage.getItem('config')!).bossRaceAdded).toEqual([7]);
        saveSetting('importBattles', true);
        await flushSettings();
        expect(puts()).toEqual([]);
    });

    it('loadSetting falls back when the value is invalid', () => {
        saveSetting('skillCcModel', 'x');
        expect(loadSetting('skillCcModel', 7, isNum)).toBe(7);
    });

    it('an unknown key throws', () => {
        expect(() => settingsStorage.getItem('nope')).toThrow();
        expect(() => settingsStorage.setItem('nope', '1')).toThrow();
        expect(() => settingsStorage.removeItem('nope')).toThrow();
        expect(() => saveSetting('nope', 1)).toThrow();
    });

    it('a failed load (403 or fetch throws) stays unhydrated and never saves', async () => {
        stubFetch(null, 403);
        await hydrateSettings();
        settingsStorage.setItem('trackedDebuffCCIds', '[9]');
        await flushSettings();
        expect(puts()).toEqual([]);
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));
        await hydrateSettings();
        settingsStorage.setItem('trackedDebuffCCIds', '[8]');
        await flushSettings();
        expect(settingsStorage.getItem('trackedDebuffCCIds')).toBe('[8]');
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});

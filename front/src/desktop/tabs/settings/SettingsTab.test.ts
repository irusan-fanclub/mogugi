// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';

const emitDesktop = vi.fn();
vi.mock('@/lib/desktopBridge', () => ({ emitDesktop: (...a: unknown[]) => emitDesktop(...a) }));
const openURL = vi.fn();
vi.mock('@wailsio/runtime', () => ({ Browser: { OpenURL: (u: string) => openURL(u) } }));
vi.mock('@/lib/runtimeEnv', () => ({ isDesktop: () => true }));
const getConfig = vi.fn();
const putConfig = vi.fn();
const openConfigFile = vi.fn();
const revealConfigFile = vi.fn();
vi.mock('@/lib/configApi', async importOriginal => ({
    ...(await importOriginal<typeof import('@/lib/configApi')>()),
    getConfig: () => getConfig(), putConfig: (b: unknown) => putConfig(b),
    openConfigFile: () => openConfigFile(), revealConfigFile: () => revealConfigFile(),
}));
const openLogsDir = vi.fn();
const getLogUsage = vi.fn();
const clearLogs = vi.fn();
const packLogs = vi.fn();
vi.mock('@/lib/logsApi', () => ({
    openLogsDir: () => openLogsDir(), getLogUsage: () => getLogUsage(),
    clearLogs: (k: string) => clearLogs(k), packLogs: () => packLogs(),
}));

import SettingsTab from './SettingsTab.vue';
import DContextMenu from '../../ui/DContextMenu.vue';
import { useContextMenu } from '../../ui/useContextMenu';
import { LICENSE_GUARD_KEY, SESSION_KEY } from '../../session';
import { captureStatus } from '@/store';
import { useToast } from '../../ui/useToast';

const FILE = { savePcapng: false, autoOpenBrowser: true, autoPort: false, port: 8030, dpsDisplay: 'desktop', allowLan: false, memoryLimitMB: 150 };
let w: VueWrapper | null = null;
const connected = ref(true);

async function mountTab() {
    const Host = defineComponent({ setup: () => () => [h(SettingsTab), h(DContextMenu)] });
    w = mount(Host, {
        attachTo: document.body,
        global: { provide: {
            [SESSION_KEY as symbol]: () => ({ connected }),
            [LICENSE_GUARD_KEY as symbol]: () => false,
        } },
    });
    await flushPromises();
}
beforeEach(() => {
    getConfig.mockResolvedValue({ path: 'C:\\cfg.toml', file: { ...FILE }, effective: { ...FILE, port: 8031 }, loadError: '' });
    putConfig.mockImplementation(async (b: typeof FILE) => ({ saved: b, path: 'C:\\cfg.toml', restartRequired: true }));
    getLogUsage.mockResolvedValue({ logBytes: 2048, pcapBytes: 5 * 1024 * 1024 });
    clearLogs.mockResolvedValue({ freedBytes: 1, failed: [] });
    packLogs.mockResolvedValue('debug_20261028_101010.zip');
    useToast().items.splice(0);
    captureStatus.value = { npcapOk: true, gameDetected: false, capturing: false, lastPacketAt: 0 };
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no')));
});
afterEach(() => {
    useContextMenu().close(); w?.unmount(); w = null; document.body.innerHTML = '';
    vi.clearAllMocks(); vi.unstubAllGlobals(); captureStatus.value = null;
});
const q = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;
const saveBtn = () => q<HTMLButtonElement>('[data-save]');
const portInput = () => q<HTMLInputElement>('[data-port] input');
async function setPort(v: string) {
    portInput().value = v; portInput().dispatchEvent(new Event('input')); await flushPromises();
}

describe('SettingsTab application section', () => {
    it('invalid port disables save and shows an error', async () => {
        await mountTab();
        await setPort('99999');
        expect(saveBtn().disabled).toBe(true);
        expect(q('[data-port]').textContent).toContain('1024');
    });
    it('is clean at first; editing a switch enables save', async () => {
        await mountTab();
        expect(saveBtn().disabled).toBe(true);
        q('[data-pcap]').click(); await flushPromises();
        expect(saveBtn().disabled).toBe(false);
    });
    it('allowLan is saved with the draft and hints at restart', async () => {
        await mountTab();
        q('[data-lan]').click(); await flushPromises();
        saveBtn().click(); await flushPromises();
        expect(putConfig).toHaveBeenCalledWith(expect.objectContaining({ allowLan: true }));
        expect(q('[data-saved]').textContent).toContain('重啟後生效');
    });
    it('dps switch saves at once without unsaved draft edits', async () => {
        await mountTab();
        await setPort('9000');
        q<HTMLButtonElement>('[data-dps] [role="radio"]:last-child').click(); await flushPromises();
        expect(putConfig).toHaveBeenCalledTimes(1);
        const body = putConfig.mock.calls[0][0];
        expect(body.dpsDisplay).toBe('web');
        expect(body.port).toBe(8030);
        expect(q('[data-dps-hint]').textContent).toContain('主視窗照常可用');
    });
    it('shows the load error note', async () => {
        getConfig.mockResolvedValue({ path: 'p', file: { ...FILE }, effective: { ...FILE }, loadError: 'bad' });
        await mountTab();
        expect(document.body.textContent).toContain('設定檔有問題');
    });
    it('keeps backend text in the load error unconverted', async () => {
        const msg = String.raw`C:\Users\x\mogugi-config.toml bad`;
        getConfig.mockResolvedValue({ path: 'p', file: { ...FILE }, effective: { ...FILE }, loadError: msg });
        await mountTab();
        const t = document.body.textContent!;
        expect(t).toContain(msg);
        expect(t).toContain('設定檔有問題，已改用預設值：');
    });
    it('invalid port does not block saving while auto port is on', async () => {
        await mountTab();
        await setPort('99999');
        q('[data-autoport]').click(); await flushPromises();
        expect(saveBtn().disabled).toBe(false);
        saveBtn().click(); await flushPromises();
        expect(putConfig.mock.calls[0][0]).toMatchObject({ autoPort: true, port: 8030 });
    });
    it('shows a save error from the backend', async () => {
        putConfig.mockRejectedValue(new Error('設定內容不完整'));
        await mountTab();
        q('[data-pcap]').click(); await flushPromises();
        saveBtn().click(); await flushPromises();
        expect(document.body.textContent).toContain('設定內容不完整');
    });
    it('disables the port field while auto port is on', async () => {
        await mountTab();
        q('[data-autoport]').click(); await flushPromises();
        expect(portInput().disabled).toBe(true);
    });
});

describe('SettingsTab memory limit', () => {
    const memInput = () => q<HTMLInputElement>('[data-memory] input');
    async function setMem(v: string) {
        memInput().value = v; memInput().dispatchEvent(new Event('input')); await flushPromises();
    }
    it('shows the label, unit, bounds and hint', async () => {
        await mountTab();
        const t = q('[data-memory]').textContent!;
        expect(t).toContain('戰鬥資料記憶體上限');
        expect(t).toContain('MB');
        expect(t).toContain('白名單副本另有紀錄可查');
        expect(memInput().value).toBe('150');
        expect([memInput().min, memInput().max, memInput().step]).toEqual(['50', '1000', '10']);
    });
    it('saves the new limit and shows no restart hint for it', async () => {
        await mountTab();
        await setMem('300');
        saveBtn().click(); await flushPromises();
        expect(putConfig.mock.calls[0][0]).toMatchObject({ memoryLimitMB: 300 });
        expect(q('[data-saved]').textContent).not.toContain('記憶體');
    });
    it('out-of-range value shows an error and disables save', async () => {
        await mountTab();
        await setMem('20');
        expect(saveBtn().disabled).toBe(true);
        expect(q('[data-memory]').textContent).toContain('須介於 50 到 1000 MB');
    });
});

describe('SettingsTab web UI block', () => {
    it('shows the url, opens and copies it', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        await mountTab();
        expect(q('[data-url]').textContent).toContain('http://127.0.0.1:8031/');
        q('[data-open]').click();
        expect(emitDesktop).toHaveBeenCalledWith('control:open-browser');
        q('[data-copy-url]').click(); await flushPromises();
        expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:8031/');
    });
    it('context menu copies the config path', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        await mountTab();
        q('[data-path]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        await flushPromises();
        document.querySelector<HTMLElement>('[role="menuitem"]')!.click(); await flushPromises();
        expect(writeText).toHaveBeenCalledWith('C:\\cfg.toml');
    });
});

describe('SettingsTab Npcap diagnostics', () => {
    it('opens the Npcap link through the Wails runtime', async () => {
        await mountTab();
        q('[data-npcap]').click(); await flushPromises();
        expect(openURL).toHaveBeenCalledWith('https://npcap.com');
    });
    it('renders the four capture checks from the store', async () => {
        await mountTab();
        const rows = Array.from(document.querySelectorAll('[data-check]')).map(r => [r.textContent!.trim(), r.getAttribute('data-ok')]);
        expect(rows).toEqual([
            ['後端已連線', 'true'], ['Npcap 已安裝', 'true'], ['偵測到遊戲連線', 'false'], ['正在擷取封包', 'false'],
        ]);
    });
});

describe('SettingsTab restructure', () => {
    it('no longer shows the current port', async () => {
        await mountTab();
        expect(document.body.textContent).not.toContain('目前使用 port');
    });
    it('config row buttons call the open and reveal endpoints', async () => {
        await mountTab();
        q('[aria-label="開啟設定檔"]').click(); await flushPromises();
        expect(openConfigFile).toHaveBeenCalledTimes(1);
        q('[aria-label="開啟設定檔資料夾"]').click(); await flushPromises();
        expect(revealConfigFile).toHaveBeenCalledTimes(1);
    });
    it('web UI block holds the five items; LAN hint when allowLan is off', async () => {
        await mountTab();
        const t = q('[data-web-block]').textContent!;
        for (const x of ['是否使用網頁版UI', '啟動時自動開啟瀏覽器', '網頁版 URL', '允許區網連線', '區網連線 URL']) expect(t).toContain(x);
        expect(q('[data-web-block] [data-dps]')).toBeTruthy();
        expect(q('[data-lan-hint]').textContent).toContain('需開啟允許區網連線並重新啟動');
        expect(document.querySelectorAll('[data-lan-url]').length).toBe(0);
    });
    it('lists one copyable row per LAN url when allowLan is effective', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        getConfig.mockResolvedValue({
            path: 'p', file: { ...FILE, allowLan: true },
            effective: { ...FILE, allowLan: true, lanUrls: ['http://192.168.1.5:8030/', 'http://10.0.0.2:8030/'] }, loadError: '',
        });
        await mountTab();
        const rows = Array.from(document.querySelectorAll('[data-lan-url]')).map(r => r.textContent);
        expect(rows.length).toBe(2);
        expect(rows[0]).toContain('http://192.168.1.5:8030/');
        expect(rows[1]).toContain('http://10.0.0.2:8030/');
        expect(document.querySelector('[data-lan-hint]')).toBeNull();
        q<HTMLElement>('[data-lan-url] [aria-label="複製"]').click(); await flushPromises();
        expect(writeText).toHaveBeenCalledWith('http://192.168.1.5:8030/');
    });
    it('shows the hint when allowLan is saved but not yet effective', async () => {
        getConfig.mockResolvedValue({
            path: 'p', file: { ...FILE, allowLan: true }, effective: { ...FILE, allowLan: false, lanUrls: [] }, loadError: '',
        });
        await mountTab();
        expect(q('[data-lan-hint]')).toBeTruthy();
    });
});

describe('SettingsTab LOG block', () => {
    const clearBtn = (k: string) => q<HTMLButtonElement>(`[data-clear-${k}]`);
    it('opens the log folder', async () => {
        await mountTab();
        q('[data-open-logs]').click(); await flushPromises();
        expect(openLogsDir).toHaveBeenCalledTimes(1);
    });
    it('shows both usages via humanReadableBytes', async () => {
        await mountTab();
        expect(q('[data-log-usage]').textContent).toContain('2.00 KB');
        expect(q('[data-pcap-usage]').textContent).toContain('5.00 MB');
        expect(q('[data-log-block]').textContent).toContain('LOG 使用空間');
        expect(q('[data-log-block]').textContent).toContain('原始紀錄使用空間');
    });
    it('clear needs two clicks, then refreshes the usage', async () => {
        await mountTab();
        expect(getLogUsage).toHaveBeenCalledTimes(1);
        clearBtn('log').click(); await flushPromises();
        expect(clearLogs).not.toHaveBeenCalled();
        expect(clearBtn('log').textContent).toContain('確認清除');
        clearBtn('log').click(); await flushPromises();
        expect(clearLogs).toHaveBeenCalledWith('log');
        expect(getLogUsage).toHaveBeenCalledTimes(2);
        expect(clearBtn('log').textContent).not.toContain('確認');
    });
    it('pcap clear uses kind pcap', async () => {
        await mountTab();
        clearBtn('pcap').click(); await flushPromises();
        clearBtn('pcap').click(); await flushPromises();
        expect(clearLogs).toHaveBeenCalledWith('pcap');
    });
    it('a partial clear toasts how many files failed', async () => {
        clearLogs.mockResolvedValue({ freedBytes: 10, failed: ['a', 'b'] });
        await mountTab();
        clearBtn('log').click(); await flushPromises();
        clearBtn('log').click(); await flushPromises();
        expect(useToast().items.map(t => t.text).join('|')).toContain('2 個檔案清除失敗');
    });
    it('pack calls the endpoint and toasts the zip name', async () => {
        await mountTab();
        q('[data-pack]').click(); await flushPromises();
        expect(packLogs).toHaveBeenCalledTimes(1);
        expect(useToast().items.map(t => t.text).join('|')).toContain('debug_20261028_101010.zip');
        expect(q('[data-log-block]').textContent).toContain('用此功能打包除錯資訊給開發者');
    });
    it('savePacketLog and savePcapng save through the draft with a restart hint', async () => {
        await mountTab();
        expect(saveBtn().disabled).toBe(true);
        q('[data-save-log]').click(); await flushPromises();
        expect(saveBtn().disabled).toBe(false);
        saveBtn().click(); await flushPromises();
        expect(putConfig).toHaveBeenCalledWith(expect.objectContaining({ savePacketLog: true }));
        expect(q('[data-saved]').textContent).toContain('保存LOG：重新啟動 mogugi 後生效');
        expect(q('[data-log-block] [data-pcap]')).toBeTruthy();
    });
});

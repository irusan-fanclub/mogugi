// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { nextTick, ref } from 'vue';
import { flushPromises, mount, VueWrapper } from '@vue/test-utils';
import { defaultOverlaySettings, type OverlaySettings } from '@/lib/overlaySettings';

const h = vi.hoisted(() => ({ encode: vi.fn(), download: vi.fn() }));
const settings = ref<OverlaySettings>(defaultOverlaySettings());
vi.mock('../../overlay/overlayLink', () => ({ get overlaySettings() { return settings; } }));
vi.mock('../../overlay/useOverlayState', () => ({
    useOverlayState: () => ({ state: ref({ layout: { dps: { enabled: true } } }) }),
}));
vi.mock('@/lib/overlayShareCodec', async orig => ({
    ...(await orig<typeof import('@/lib/overlayShareCodec')>()),
    encodeShare: h.encode,
}));
vi.mock('@/lib/csvExport', () => ({ downloadText: h.download }));

import ShareExportDialog from './ShareExportDialog.vue';

let w: VueWrapper | null = null;
const writeText = vi.fn();
beforeEach(() => {
    h.encode.mockReset(); h.download.mockReset(); writeText.mockReset();
    writeText.mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
});
afterEach(() => { w?.unmount(); w = null; vi.unstubAllGlobals(); vi.useRealTimers(); });

const open = async (text: string) => {
    h.encode.mockResolvedValue(text);
    w = mount(ShareExportDialog, { props: { modelValue: true }, attachTo: document.body });
    await flushPromises();
};
const q = (sel: string) => document.body.querySelector(sel);
const btn = (label: string) => Array.from(document.body.querySelectorAll('button')).find(b => b.textContent?.includes(label))!;

describe('ShareExportDialog', () => {
    it('shows the share text and the count without a warning when short', async () => {
        await open('mogugi-overlay:1:' + 'a'.repeat(100));
        expect((q('textarea') as HTMLTextAreaElement).value.startsWith('mogugi-overlay:1:')).toBe(true);
        expect(document.body.textContent).toContain('117 字');
        expect(document.body.textContent).toContain('包含：9 個大區的設定、所有區塊的位置');
        expect(document.body.textContent).toContain('不包含：快捷鍵、語音選用的聲音');
        expect(q('[data-share-warn]')).toBeNull();
    });

    it('warns with a thousands separator when over the Discord limit', async () => {
        await open('mogugi-overlay:1:' + 'a'.repeat(2400));
        expect(q('[data-share-warn]')?.textContent).toContain('2,417 字，超過 Discord 單則訊息上限');
    });

    it('copies the text and shows 已複製 for 2 s', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        await open('mogugi-overlay:1:abc');
        btn('複製文字').click();
        await flushPromises();
        expect(writeText).toHaveBeenCalledWith('mogugi-overlay:1:abc');
        expect(document.body.textContent).toContain('已複製');
        vi.advanceTimersByTime(2000);
        await nextTick();
        expect(document.body.textContent).not.toContain('已複製');
        expect(document.body.textContent).toContain('複製文字');
    });

    it('saves the text to a dated file', async () => {
        await open('mogugi-overlay:1:abc');
        btn('存成檔案').click();
        expect(h.download).toHaveBeenCalledTimes(1);
        expect(h.download.mock.calls[0][0]).toMatch(/^mogugi-overlay-\d{8}\.txt$/);
        expect(h.download.mock.calls[0][1]).toBe('mogugi-overlay:1:abc');
    });
});

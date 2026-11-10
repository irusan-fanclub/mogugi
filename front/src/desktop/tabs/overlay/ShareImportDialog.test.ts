// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { ref } from 'vue';
import { flushPromises, mount, VueWrapper } from '@vue/test-utils';
import { defaultOverlaySettings, type OverlaySettings } from '@/lib/overlaySettings';
import { encodeShare, SHARE_ERROR_TEXT } from '@/lib/overlayShareCodec';

const h = vi.hoisted(() => ({ replaceLayouts: vi.fn(), update: vi.fn(), decodes: [] as Promise<unknown>[] }));
// Record every decode so tests can await it instead of sleeping.
vi.mock('@/lib/overlayShareCodec', async orig => {
    const m = await orig<typeof import('@/lib/overlayShareCodec')>();
    return { ...m, decodeShare: (t: string) => { const p = m.decodeShare(t); h.decodes.push(p); return p; } };
});

const settings = ref<OverlaySettings>(defaultOverlaySettings());
const layout = { dps: { enabled: true, anchor: 'tr', x: -24, y: 24, width: 260, maxRows: 8 } };
vi.mock('../../overlay/overlayLink', () => ({
    get overlaySettings() { return settings; },
    updateOverlaySettings: (mut: (s: OverlaySettings) => void) => {
        h.update();
        const next = JSON.parse(JSON.stringify(settings.value)) as OverlaySettings;
        mut(next);
        settings.value = next;
    },
}));
vi.mock('../../overlay/useOverlayState', () => ({
    useOverlayState: () => ({ state: ref({ layout }), replaceLayouts: h.replaceLayouts }),
}));

import ShareImportDialog from './ShareImportDialog.vue';

let w: VueWrapper | null = null;
let shared = '';
beforeEach(async () => {
    h.replaceLayouts.mockReset(); h.update.mockReset(); h.decodes.length = 0;
    settings.value = defaultOverlaySettings();
    const theirs = defaultOverlaySettings();
    theirs.scale = 130;
    shared = await encodeShare(theirs, { dps: { enabled: false, anchor: 'tl', x: 5, y: 6, width: 300, maxRows: 4 } });
});
afterEach(() => { w?.unmount(); w = null; vi.useRealTimers(); });

const q = (sel: string) => document.body.querySelector(sel) as HTMLElement | null;
const btn = (label: string) => Array.from(document.body.querySelectorAll('button')).find(b => b.textContent?.trim().includes(label))!;
const mountDlg = () => (w = mount(ShareImportDialog, { props: { modelValue: true }, attachTo: document.body }));
const paste = async (text: string) => {
    const ta = q('textarea') as HTMLTextAreaElement;
    ta.value = text;
    ta.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(250);
    // The debounce has fired; wait for the real (stream-based) decode to settle.
    await Promise.all(h.decodes);
    await flushPromises();
};
const toStep2 = async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mountDlg();
    await paste(shared);
};

describe('ShareImportDialog', () => {
    it('step 1: junk shows the notShare copy', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        mountDlg();
        await paste('hello');
        expect(q('[data-share-error]')?.textContent).toContain(SHARE_ERROR_TEXT.notShare);
        expect(q('[data-region-row]')).toBeNull();
    });

    it('step 2: a valid share lists 9 rows, import on and position off', async () => {
        await toStep2();
        expect(document.body.textContent).toContain('讀取成功，選擇要套用哪些部分');
        expect(document.body.querySelectorAll('[data-region-row]')).toHaveLength(9);
        expect(q('[data-import-dps]')!.getAttribute('aria-checked')).toBe('true');
        expect(q('[data-position-dps]')!.getAttribute('aria-checked')).toBe('false');
    });

    it('unchecking 匯入 disables that row position; 通用 position is always disabled', async () => {
        await toStep2();
        expect(q('[data-position-dps]')!.hasAttribute('disabled')).toBe(false);
        q('[data-import-dps]')!.click();
        await flushPromises();
        expect(q('[data-position-dps]')!.hasAttribute('disabled')).toBe(true);
        expect(q('[data-position-general]')!.hasAttribute('disabled')).toBe(true);
        expect(document.body.textContent).toContain('無位置');
    });

    it('套用 is disabled when nothing is checked', async () => {
        await toStep2();
        const bulk = Array.from(document.body.querySelectorAll('[data-bulk="import-none"]'))[0] as HTMLElement;
        bulk.click();
        await flushPromises();
        expect(btn('套用').hasAttribute('disabled')).toBe(true);
    });

    it('套用 sends layouts before settings, shows the result, 復原 restores', async () => {
        await toStep2();
        q('[data-position-dps]')!.click();
        await flushPromises();
        btn('套用').click();
        await flushPromises();
        expect(h.replaceLayouts).toHaveBeenCalledTimes(1);
        expect(h.replaceLayouts.mock.invocationCallOrder[0]).toBeLessThan(h.update.mock.invocationCallOrder[0]);
        expect(settings.value.scale).toBe(130);
        expect(document.body.textContent).toContain('已套用 9 個大區，其中 1 個連同位置');
        expect(document.body.textContent).toContain('不滿意的話可以按「復原」');

        btn('復原').click();
        await flushPromises();
        expect(h.replaceLayouts).toHaveBeenCalledTimes(2);
        const [saves] = h.replaceLayouts.mock.calls[1];
        expect(saves.dps).toEqual(layout.dps);
        expect(settings.value.scale).toBe(defaultOverlaySettings().scale);
        expect(document.body.textContent).toContain('已復原成匯入前的設定');
        expect(btn('復原')).toBeUndefined();
    });

    it('omits the position clause when none were applied', async () => {
        await toStep2();
        btn('套用').click();
        await flushPromises();
        expect(document.body.textContent).toContain('已套用 9 個大區');
        expect(document.body.textContent).not.toContain('連同位置');
    });

    it('closing resets to step 1', async () => {
        await toStep2();
        await w!.setProps({ modelValue: false });
        await w!.setProps({ modelValue: true });
        await flushPromises();
        expect(q('[data-region-row]')).toBeNull();
        expect((q('textarea') as HTMLTextAreaElement).value).toBe('');
    });

    it('rejects files over 1 MB without reading them', async () => {
        mountDlg();
        const text = vi.fn();
        const file = { size: 1_048_577, text } as unknown as File;
        const input = q('input[type=file]') as HTMLInputElement;
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input.dispatchEvent(new Event('change'));
        await flushPromises();
        expect(text).not.toHaveBeenCalled();
        expect(q('[data-share-error]')?.textContent).toContain(SHARE_ERROR_TEXT.tooBig);
    });

    it('drops a slow file read that resolves after the dialog closed', async () => {
        mountDlg();
        let done!: (t: string) => void;
        const file = { size: 10, text: () => new Promise<string>(r => { done = r; }) } as unknown as File;
        const input = q('input[type=file]') as HTMLInputElement;
        Object.defineProperty(input, 'files', { value: [file], configurable: true });
        input.dispatchEvent(new Event('change'));
        await w!.setProps({ modelValue: false });
        await w!.setProps({ modelValue: true });
        done(shared);
        await flushPromises();
        await Promise.all(h.decodes);
        await flushPromises();
        expect(q('[data-region-row]')).toBeNull();
        expect(q('textarea')).not.toBeNull();
    });
});

// @vitest-environment happy-dom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';

const h2c = vi.fn();
vi.mock('html2canvas', () => ({ default: (...a: unknown[]) => h2c(...a) }));

import { captureBattle, shotContextText, shotFileName, shotFooterText } from './screenshot';

const title = { version: '9.9.9' };
const els = () => ({ chart: document.createElement('div'), list: document.createElement('div') });
const fake = (w: number, h: number) => ({ width: w, height: h });

let created: HTMLAnchorElement[] = [];
beforeEach(() => {
    h2c.mockReset();
    created = [];
    const ctx = {
        fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn(), measureText: () => ({ width: 10 }),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob(['x'], { type: 'image/png' })));
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { created.push(this); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('shotContextText', () => {
    it('says the target and whether the range is filtered', () => {
        expect(shotContextText('21:17:04 雷楠的米勒', '1:20 ~ 7:54')).toBe('目標：21:17:04 雷楠的米勒｜範圍：1:20 ~ 7:54');
        expect(shotContextText('全部目標', null)).toBe('目標：全部目標');
    });
});

describe('captureBattle', () => {
    it('falls back to a download when ClipboardItem does not exist', async () => {
        h2c.mockResolvedValue(fake(100, 50));
        vi.stubGlobal('ClipboardItem', undefined);
        expect(await captureBattle(els(), title)).toBe('download');
        expect(created).toHaveLength(1);
        expect(created[0].download).toMatch(/^mogugi_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}\.png$/);
    });

    it('writes the clipboard when available', async () => {
        h2c.mockResolvedValue(fake(100, 50));
        const write = vi.fn(async () => {});
        vi.stubGlobal('ClipboardItem', class { constructor(public d: unknown) {} });
        Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
        expect(await captureBattle(els(), title)).toBe('clipboard');
        expect(write).toHaveBeenCalledOnce();
        expect(created).toHaveLength(0);
    });

    it('downloads when the clipboard write rejects', async () => {
        h2c.mockResolvedValue(fake(100, 50));
        vi.stubGlobal('ClipboardItem', class { constructor(public d: unknown) {} });
        Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn(async () => { throw new Error('denied'); }) }, configurable: true });
        expect(await captureBattle(els(), title)).toBe('download');
    });

    it('hides [data-shot-hide] in the clone without removing it, so rows keep their layout', async () => {
        h2c.mockResolvedValue(fake(0, 0));
        await captureBattle(els(), title);
        const onclone = (h2c.mock.calls[0][1] as { onclone: (d: Document) => void }).onclone;
        const doc = document.implementation.createHTMLDocument('x');
        doc.body.innerHTML = '<div><span data-shot-hide>a</span><span>b</span></div>';
        onclone(doc);
        const hidden = doc.querySelector<HTMLElement>('[data-shot-hide]')!;
        expect(hidden.style.visibility).toBe('hidden');
        expect(hidden.isConnected).toBe(true);
    });

    it('returns empty when every canvas has no size', async () => {
        h2c.mockResolvedValue(fake(0, 0));
        expect(await captureBattle(els(), title)).toBe('empty');
    });

    it('renders with scale 2 and stacks the blocks with a 7px gap above a 20px footer', async () => {
        h2c.mockResolvedValueOnce(fake(100, 50)).mockResolvedValueOnce(fake(120, 80));
        vi.stubGlobal('ClipboardItem', undefined);
        let size = [0, 0];
        const orig = document.createElement.bind(document);
        vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
            const e = orig(tag);
            if (tag === 'canvas') {
                size = [0, 0];
                Object.defineProperty(e, 'width', { set: v => { size[0] = v; }, get: () => size[0] });
                Object.defineProperty(e, 'height', { set: v => { size[1] = v; }, get: () => size[1] });
            }
            return e;
        });
        await captureBattle(els(), title);
        expect(h2c.mock.calls[0][1]).toMatchObject({ scale: 2 });
        expect(size).toEqual([120, 50 + 14 + 80 + 40]);
    });

    it('propagates a render failure', async () => {
        h2c.mockRejectedValue(new Error('boom'));
        await expect(captureBattle(els(), title)).rejects.toThrow('boom');
    });
});

describe('shotFooterText', () => {
    it('joins version and local minute', () => {
        expect(shotFooterText('0.5.7', new Date(2026, 9, 19, 23, 47), 'tw1')).toContain('mogugi v0.5.7 · 2026-10-19 23:47');
    });
});

describe('shotFileName', () => {
    it('formats local time with zero padding', () => {
        expect(shotFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe('mogugi_2026-01-02-03-04-05.png');
    });
});

describe('shotFooterText client', () => {
    const at = new Date(2026, 9, 19, 23, 47);
    it('appends the client version', () => {
        expect(shotFooterText('0.5.7', at, 'tw100')).toBe('mogugi v0.5.7 · 2026-10-19 23:47 · Client: tw100');
    });
    it('shows - when absent', () => {
        expect(shotFooterText('0.5.7', at)).toBe('mogugi v0.5.7 · 2026-10-19 23:47 · Client: -');
    });
});

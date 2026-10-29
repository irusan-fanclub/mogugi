// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { copyWithFallback, fetchCaptureStatus } from './captureStatus';

afterEach(() => vi.unstubAllGlobals());

describe('copyWithFallback', () => {
    it('copies via the clipboard', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        expect(await copyWithFallback('abc', 'http://x')).toBe('copied');
        expect(writeText).toHaveBeenCalledWith('abc');
    });
    it('opens the fallback url when the clipboard rejects', async () => {
        vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) } });
        const open = vi.fn();
        vi.stubGlobal('open', open);
        expect(await copyWithFallback('abc', 'http://x')).toBe('opened');
        expect(open).toHaveBeenCalledWith('http://x', '_blank', 'noopener');
    });
    it('fails when the clipboard rejects and there is no fallback', async () => {
        vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) } });
        expect(await copyWithFallback('abc')).toBe('failed');
    });
});

describe('fetchCaptureStatus', () => {
    it('maps the backend fields', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            json: async () => ({ NpcapOk: true, GameDetected: 1, Capturing: false, LastPacketAt: 5 }),
        }));
        expect(await fetchCaptureStatus()).toEqual({ npcapOk: true, gameDetected: true, capturing: false, lastPacketAt: 5 });
    });
    it('returns null on failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('down')));
        expect(await fetchCaptureStatus()).toBeNull();
    });
});

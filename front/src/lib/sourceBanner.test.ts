import { describe, it, expect } from 'vitest';
import { sourceBannerText } from './sourceBanner';
import type { sourceState } from '@/protocols';

const base: sourceState = { Mode: 'replay', File: 'a.pcapng', Done: 0, Total: 0, Finished: false, Err: '', Notice: '' };

describe('sourceBannerText', () => {
    it('shows nothing for live or no state', () => {
        expect(sourceBannerText(null)).toBe('');
        expect(sourceBannerText({ ...base, Mode: 'live' })).toBe('');
    });
    it('shows progress while replaying', () => {
        expect(sourceBannerText({ ...base, Done: 50, Total: 200 })).toBe('重播中：a.pcapng 25%');
        expect(sourceBannerText(base)).toBe('重播中：a.pcapng');
    });
    it('shows completion', () => {
        expect(sourceBannerText({ ...base, Finished: true, Done: 9, Total: 9 })).toBe('重播完成：a.pcapng');
    });
    it('shows the error even when back on live', () => {
        expect(sourceBannerText({ ...base, Mode: 'live', Err: '格式錯誤' })).toBe('無法重播 a.pcapng：格式錯誤');
    });
    it('appends the notice to the replay text', () => {
        expect(sourceBannerText({ ...base, Notice: '已匯入過。' })).toBe('重播中：a.pcapng　已匯入過。');
        expect(sourceBannerText({ ...base, Finished: true, Notice: '已匯入過。' })).toBe('重播完成：a.pcapng　已匯入過。');
        expect(sourceBannerText({ ...base, Err: 'x', Notice: 'n' })).toBe('無法重播 a.pcapng：x　n');
    });
});

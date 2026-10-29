import { describe, it, expect } from 'vitest';
import { captureView } from './captureView';

const st = (o: Partial<{ npcapOk: boolean; gameDetected: boolean; capturing: boolean }>) =>
    ({ npcapOk: true, gameDetected: false, capturing: false, lastPacketAt: 0, ...o });

describe('captureView', () => {
    it('covers every state', () => {
        expect(captureView(false, st({ capturing: true }))).toEqual({ text: '後端未連線', tone: 'err' });
        expect(captureView(true, null).text).toBe('狀態未知');
        expect(captureView(true, st({ npcapOk: false })).text).toBe('未偵測到 Npcap');
        expect(captureView(true, st({ capturing: true })).tone).toBe('ok');
        expect(captureView(true, st({ gameDetected: true })).text).toBe('已偵測到遊戲，等待封包');
        expect(captureView(true, st({})).text).toBe('等待遊戲啟動');
    });
});

import type { CaptureStatus } from '@/store';

export type Tone = 'ok' | 'warn' | 'err' | 'idle';

// Same wording as the control panel's statusText.
export function captureView(connected: boolean, s: CaptureStatus | null): { text: string; tone: Tone } {
    if (!connected) return { text: '後端未連線', tone: 'err' };
    if (!s) return { text: '狀態未知', tone: 'idle' };
    if (!s.npcapOk) return { text: '未偵測到 Npcap', tone: 'err' };
    if (s.capturing) return { text: '擷取中', tone: 'ok' };
    if (s.gameDetected) return { text: '已偵測到遊戲，等待封包', tone: 'warn' };
    return { text: '等待遊戲啟動', tone: 'idle' };
}

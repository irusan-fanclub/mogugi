import type { CaptureStatus } from '@/store';

// GET /api/status fallback for a client that missed the socket's snapshot; null on any failure.
export async function fetchCaptureStatus(): Promise<CaptureStatus | null> {
    try {
        const d = await (await fetch('/api/status')).json();
        return {
            npcapOk: !!d.NpcapOk,
            gameDetected: !!d.GameDetected,
            capturing: !!d.Capturing,
            lastPacketAt: d.LastPacketAt || 0,
        };
    } catch {
        return null;
    }
}

// Copy text; if the clipboard is unavailable open fallbackUrl instead (when given).
export async function copyWithFallback(text: string, fallbackUrl?: string): Promise<'copied' | 'opened' | 'failed'> {
    try {
        await navigator.clipboard.writeText(text);
        return 'copied';
    } catch {
        if (!fallbackUrl) return 'failed';
        window.open(fallbackUrl, '_blank', 'noopener');
        return 'opened';
    }
}

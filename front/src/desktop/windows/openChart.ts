import { emitDesktop } from '@/lib/desktopBridge';
import { isDesktop } from '@/lib/runtimeEnv';
import { EV, type ChartSpec } from '@/lib/chartProtocol';
import { chartHubId } from '@/lib/chartTransport';

// Two independent 32-bit FNV-1a hashes keep accidental collisions negligible.
function hash(s: string): string {
    let a = 0x811c9dc5;
    let b = 0x01000193;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        a = Math.imul(a ^ c, 0x01000193) >>> 0;
        b = Math.imul(b + c, 0x85ebca6b) >>> 0;
        b ^= b >>> 13;
    }
    return a.toString(36) + b.toString(36);
}

/** Same spec, same id: `^[a-z0-9-]{1,40}$`, so one window per spec. */
export function chartId(spec: ChartSpec): string {
    const s = spec as { attackerId?: string; skillId?: number; targetId?: string };
    const key = [spec.kind, s.attackerId ?? '', s.skillId ?? '', s.targetId ?? ''].join('|');
    return `${spec.kind}-${hash(key)}`;
}

export function openChart(spec: ChartSpec, title: string): void {
    const id = chartId(spec);
    const p = { id, kind: spec.kind, title, spec: JSON.stringify(spec) };
    // The browser opens the same chart.html URL as desktop; the id as window name keeps one tab per spec.
    if (isDesktop()) void emitDesktop(EV.open, p);
    else window.open('/chart.html?' + new URLSearchParams({ ...p, hub: chartHubId }).toString(), id);
}

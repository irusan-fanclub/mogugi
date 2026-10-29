import type { sourceState } from '@/protocols';

/** Banner text for the event source, or '' when nothing needs showing. */
export function sourceBannerText(s: sourceState | null): string {
    const t = baseText(s);
    return t && s?.Notice ? `${t}　${s.Notice}` : t;
}

function baseText(s: sourceState | null): string {
    if (!s) return '';
    if (s.Err) return `無法重播 ${s.File}：${s.Err}`;
    if (s.Mode !== 'replay') return '';
    if (s.Finished) return `重播完成：${s.File}`;
    const pct = s.Total > 0 ? ` ${Math.min(100, Math.floor((s.Done / s.Total) * 100))}%` : '';
    return `重播中：${s.File}${pct}`;
}

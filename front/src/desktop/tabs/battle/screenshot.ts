import { stackLayout } from '@/lib/util';
import { readTokens } from '../../theme/readTokens';

export type ShotResult = 'clipboard' | 'download' | 'empty';

export interface ShotFooter {
    version: string;
    at?: Date;
    client?: string;
    /** What the numbers cover (target and time range), drawn on the footer's left. */
    context?: string;
}

/** Runs on html2canvas's cloned document before it is drawn; the live page is never touched. */
export type ShotPrepare = (doc: Document) => void | Promise<void>;

/** Width the battle tab is laid out at while capturing, so a wide window still gives a phone-readable PNG. */
export const SHOT_WIDTH = 960;

export function shotContextText(target: string, range: string | null): string {
    return range ? `目標：${target}｜範圍：${range}` : `目標：${target}`;
}

// Toast texts, same as the old web UI.
export const SHOT_TEXT = {
    clipboard: '已截圖到剪貼簿',
    download: '無法寫入剪貼簿（視窗失焦或權限不足），已改為下載 PNG',
    empty: '沒有可截圖的內容',
    failed: '截圖失敗',
} as const;

const SCALE = 2;
const GAP = 7;
const FOOTER_H = 20;

export function shotFooterText(version: string, at: Date, client?: string): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `mogugi v${version} · ${at.getFullYear()}-${p(at.getMonth() + 1)}-${p(at.getDate())}`
        + ` ${p(at.getHours())}:${p(at.getMinutes())}`
        + ` · Client: ${client || '-'}`;
}

export function shotFileName(d = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `mogugi_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
        + `-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}.png`;
}

// [data-shot-hide] keeps its space but is not drawn; data-html2canvas-ignore would drop it and reflow the row.
function hideShotOnly(doc: Document) {
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-shot-hide]'))) el.style.visibility = 'hidden';
}

// A lingering hover (tooltip, crosshair) would be baked into the PNG; zrender
// hides it on mouseout.
function clearChartHover(chart: HTMLElement) {
    for (const c of Array.from(chart.querySelectorAll('canvas'))) {
        c.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    }
}

/** Renders chart sheet + player list into one PNG; throws on render failure. */
export async function captureBattle(
    el: { chart: HTMLElement; list: HTMLElement },
    footer: ShotFooter,
    prepare?: ShotPrepare,
): Promise<ShotResult> {
    const { default: html2canvas } = await import('html2canvas');
    clearChartHover(el.chart);
    const t = readTokens(['--c-bg', '--c-text', '--c-text-dim', '--font-ui']);
    const bg = t['--c-bg'] || '#16181d';
    const font = t['--font-ui'] || 'sans-serif';

    const canvases = (await Promise.all([el.chart, el.list].map(e =>
        html2canvas(e, {
            scale: SCALE, useCORS: true, logging: false, backgroundColor: bg,
            onclone: async (doc: Document) => { hideShotOnly(doc); await prepare?.(doc); },
        }))))
        .filter(c => c.width > 0 && c.height > 0);
    if (canvases.length === 0) return 'empty';

    // Canvas pixels are SCALE x CSS pixels.
    const layout = stackLayout(canvases.map(c => ({ w: c.width, h: c.height })), GAP * SCALE);
    const footerH = FOOTER_H * SCALE;
    const final = document.createElement('canvas');
    final.width = layout.w;
    final.height = layout.h + footerH;
    const ctx = final.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, final.width, final.height);
    canvases.forEach((c, i) => ctx.drawImage(c, 0, layout.ys[i]));
    ctx.fillStyle = t['--c-text-dim'] || '#7d838e';
    ctx.font = `${11 * SCALE}px ${font}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    const baseline = layout.h + footerH - 6 * SCALE;
    ctx.fillText(shotFooterText(footer.version, footer.at ?? new Date(), footer.client), final.width - 8 * SCALE, baseline);
    if (footer.context) {
        ctx.fillStyle = t['--c-text'] || '#e6e6e6';
        ctx.textAlign = 'left';
        ctx.fillText(footer.context, 8 * SCALE, baseline);
    }

    const blob = await new Promise<Blob | null>(res => final.toBlob(res, 'image/png'));
    if (!blob) throw new Error('canvas.toBlob returned null');
    try {
        // Clipboard writes need a focus and a secure context; the render window can lose either.
        if (typeof ClipboardItem === 'undefined') throw new Error('ClipboardItem unavailable');
        window.focus();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return 'clipboard';
    } catch (e) {
        console.error('clipboard write failed:', e);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = shotFileName();
        a.click();
        URL.revokeObjectURL(a.href);
        return 'download';
    }
}

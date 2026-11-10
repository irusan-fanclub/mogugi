import { defaultOverlaySettings, normalizeOverlaySettings, SETTINGS_VERSION, type OverlaySettings } from './overlaySettings';
import type { OverlayLayout } from './overlayProtocol';

export const SHARE_PREFIX = 'mogugi-overlay:';
export const SHARE_FORMAT = 1;
export const DISCORD_LIMIT = 2000;

const MAX_TEXT = 1_048_576;
const MAX_JSON = 2_097_152;

export interface SharePayload { settingsV: number; settings: OverlaySettings; layouts: Record<string, unknown> }
export type ShareError = 'notShare' | 'broken' | 'newer' | 'tooBig';

export const SHARE_ERROR_TEXT: Record<ShareError, string> = {
    notShare: '這不是 mogugi 的 overlay 設定，請確認有從 mogugi-overlay: 開始整段複製',
    broken: '內容不完整，可能少複製了結尾',
    newer: '這份設定來自比較新的 mogugi，請先更新後再匯入',
    tooBig: '內容太大，不像是 overlay 設定',
};

const isPlain = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

function toBase64Url(bytes: Uint8Array): string {
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
    let b = s.replace(/-/g, '+').replace(/_/g, '/');
    b += '='.repeat((4 - (b.length % 4)) % 4);
    const bin = atob(b);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export async function encodeShare(
    settings: OverlaySettings,
    layouts: Partial<Record<string, OverlayLayout>> | undefined,
): Promise<string> {
    const { voiceName: _drop, ...voice } = settings.voice;
    const outLayouts: Record<string, OverlayLayout> = {};
    for (const [id, l] of Object.entries(layouts ?? {})) {
        if (id !== 'cc' && l) outLayouts[id] = l;
    }
    const json = JSON.stringify({ settingsV: SETTINGS_VERSION, settings: { ...settings, voice }, layouts: outLayouts });
    const stream = new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    return `${SHARE_PREFIX}${SHARE_FORMAT}:${toBase64Url(buf)}`;
}

/** Inflates to text, throwing 'tooBig' past the limit and anything else on corrupt data. */
async function inflate(bytes: Uint8Array): Promise<string> {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_JSON) {
            await reader.cancel().catch(() => {});
            throw new Error('tooBig');
        }
        chunks.push(value);
    }
    const all = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { all.set(c, off); off += c.length; }
    return new TextDecoder('utf-8', { fatal: true }).decode(all);
}

export async function decodeShare(
    text: string,
): Promise<{ ok: true; payload: SharePayload } | { ok: false; error: ShareError }> {
    const fail = (error: ShareError) => ({ ok: false as const, error });
    if (text.length > MAX_TEXT) return fail('tooBig');
    const at = text.indexOf(SHARE_PREFIX);
    if (at < 0) return fail('notShare');
    const rest = text.slice(at + SHARE_PREFIX.length);
    const m = /^(\d+):/.exec(rest);
    if (!m) return fail('notShare');
    if (Number(m[1]) > SHARE_FORMAT) return fail('newer');
    if (Number(m[1]) !== SHARE_FORMAT) return fail('notShare');

    let token = '';
    for (const ch of rest.slice(m[0].length)) {
        if (/\s/.test(ch)) continue;
        if (!/[A-Za-z0-9_-]/.test(ch)) break;
        token += ch;
    }
    if (!token || token.length % 4 === 1) return fail('broken');

    let root: unknown;
    try {
        root = JSON.parse(await inflate(fromBase64Url(token)));
    } catch (e) {
        return fail(e instanceof Error && e.message === 'tooBig' ? 'tooBig' : 'broken');
    }
    if (!isPlain(root)) return fail('broken');
    if (typeof root.settingsV === 'number' && root.settingsV > SETTINGS_VERSION) return fail('newer');

    const settings = isPlain(root.settings) ? normalizeOverlaySettings(root.settings) : defaultOverlaySettings();
    settings.voice.voiceName = '';
    return {
        ok: true,
        payload: {
            settingsV: typeof root.settingsV === 'number' ? root.settingsV : SETTINGS_VERSION,
            settings,
            layouts: isPlain(root.layouts) ? root.layouts : {},
        },
    };
}

export function shareFileName(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `mogugi-overlay-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.txt`;
}

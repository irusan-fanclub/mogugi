import { defaultOverlaySettings, normalizeOverlaySettings, SETTINGS_VERSION, type OverlaySettings } from './overlaySettings';
import type { OverlayLayout } from './overlayProtocol';
import { layoutOf } from './overlayComponents';

export const SHARE_PREFIX = 'mogugi-overlay:';
export const SHARE_FORMAT = 1;
export const DISCORD_LIMIT = 2000;

export const MAX_TEXT = 1_048_576;
const MAX_JSON = 2_097_152;
const MAX_RETRIES = 8;

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
    const voice: Omit<OverlaySettings['voice'], 'voiceName'> & { voiceName?: string } = { ...settings.voice };
    delete voice.voiceName;
    const outLayouts: Record<string, OverlayLayout> = {};
    for (const [id, l] of Object.entries(layouts ?? {})) {
        if (id !== 'cc' && l) outLayouts[id] = l;
    }
    // A legacy cc record is the BOSS position; carry it as ccBoss since cc itself is not exported.
    if (layouts?.cc && !layouts.ccBoss) outLayouts.ccBoss = layoutOf('ccBoss', layouts);
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

const isB64Char = (c: number) =>
    (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45 || c === 95;
const isSpace = (c: number) => c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x3000;

type Result = { ok: true; payload: SharePayload } | { ok: false; error: ShareError };

async function decodeToken(token: string): Promise<Result> {
    const fail = (error: ShareError): Result => ({ ok: false, error });
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

/** Decodes one prefix occurrence; on 'broken', retries with the token cut at each skipped whitespace. */
async function decodeAt(rest: string): Promise<Result> {
    const m = /^(\d+):/.exec(rest);
    if (!m) return { ok: false, error: 'notShare' };
    if (Number(m[1]) > SHARE_FORMAT) return { ok: false, error: 'newer' };
    if (Number(m[1]) !== SHARE_FORMAT) return { ok: false, error: 'notShare' };

    let token = '';
    const cuts: number[] = [];
    let skipped = false;
    for (let i = m[0].length; i < rest.length; i++) {
        const c = rest.charCodeAt(i);
        if (isSpace(c)) { skipped = true; continue; }
        if (!isB64Char(c)) break;
        if (skipped && token) cuts.push(token.length);
        skipped = false;
        token += rest[i];
    }
    let last: Result = await decodeToken(token);
    if (last.ok || last.error !== 'broken') return last;
    // Cuts are increasing: try the 4 shortest (trailing chatter), then the 4 longest.
    const picks = new Set([...cuts.slice(0, 4), ...cuts.slice(-4).reverse()]);
    for (const cut of picks) {
        last = await decodeToken(token.slice(0, cut));
        if (last.ok || last.error !== 'broken') return last;
    }
    return { ok: false, error: 'broken' };
}

const ERROR_RANK: Record<ShareError, number> = { notShare: 0, broken: 1, tooBig: 2, newer: 3 };

export async function decodeShare(text: string): Promise<Result> {
    if (text.length > MAX_TEXT) return { ok: false, error: 'tooBig' };
    let best: ShareError = 'notShare';
    // Chatter may mention the prefix first, so try the last occurrence first.
    let tries = 0;
    for (let at = text.lastIndexOf(SHARE_PREFIX); at >= 0 && tries < MAX_RETRIES; at = at > 0 ? text.lastIndexOf(SHARE_PREFIX, at - 1) : -1) {
        tries++;
        const r = await decodeAt(text.slice(at + SHARE_PREFIX.length));
        if (r.ok) return r;
        if (ERROR_RANK[r.error] > ERROR_RANK[best]) best = r.error;
    }
    return { ok: false, error: best };
}

export function shareFileName(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `mogugi-overlay-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.txt`;
}

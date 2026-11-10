import { describe, expect, it } from 'vitest';
import { defaultOverlaySettings, SETTINGS_VERSION } from './overlaySettings';
import type { OverlayLayout } from './overlayProtocol';
import { layoutOf } from './overlayComponents';
import { decodeShare, encodeShare, SHARE_ERROR_TEXT, shareFileName, SHARE_PREFIX } from './overlayShareCodec';

const L = {
    ccBoss: { x: 1, y: 2, w: 3, h: 4 },
    dps: { x: 5, y: 6, w: 7, h: 8 },
    cc: { x: 9, y: 9, w: 9, h: 9 },
} as unknown as Partial<Record<string, OverlayLayout>>;

function b64url(bytes: Uint8Array): string {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function rawEncode(obj: unknown): Promise<string> {
    const stream = new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    return `${SHARE_PREFIX}1:${b64url(buf)}`;
}

function sample() {
    const s = defaultOverlaySettings();
    s.scale = 120;
    s.voice.voiceName = 'Secret Voice';
    return s;
}

describe('overlayShareCodec', () => {
    it('round trips settings and layouts', async () => {
        const s = sample();
        const r = await decodeShare(await encodeShare(s, L));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.payload.settings).toEqual({ ...s, voice: { ...s.voice, voiceName: '' } });
        const rest: Record<string, unknown> = { ...L };
        delete rest.cc;
        expect(r.payload.layouts).toEqual(rest);
        expect(r.payload.settingsV).toBe(SETTINGS_VERSION);
    });

    it('exports a legacy cc record as ccBoss and never exports cc', async () => {
        const cc = { enabled: true, anchor: 'tr', x: -40, y: 60, width: 250, maxRows: 5 } as OverlayLayout;
        const r = await decodeShare(await encodeShare(sample(), { cc, dps: L.dps }));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.payload.layouts.cc).toBeUndefined();
        expect(r.payload.layouts.ccBoss).toEqual(layoutOf('ccBoss', { cc }));
        expect(r.payload.layouts.ccBoss).toMatchObject({ anchor: 'tr', x: -40, y: 60, width: 250 });
    });

    it('produces a pasteable single token', async () => {
        const t = await encodeShare(sample(), L);
        expect(t.startsWith('mogugi-overlay:1:')).toBe(true);
        expect(t).toMatch(/^mogugi-overlay:1:[A-Za-z0-9_-]+$/);
    });

    it('drops voiceName on export', async () => {
        const t = await encodeShare(sample(), undefined);
        expect(t).not.toContain('Secret');
        const b64 = t.slice('mogugi-overlay:1:'.length).replace(/-/g, '+').replace(/_/g, '/');
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        const json = JSON.parse(await new Response(stream).text());
        expect(json.settings.voice.voiceName).toBeUndefined();
        expect(json.layouts).toEqual({});
    });

    it('decodes text with chatter, code fences and line breaks', async () => {
        const text = await encodeShare(sample(), L);
        const noisy = '看這個 ```\n' + text.slice(0, 40) + '\n' + text.slice(40) + '\n``` 讚';
        const r = await decodeShare(noisy);
        expect(r.ok).toBe(true);
    });

    it('reports errors', async () => {
        const t = await encodeShare(sample(), L);
        expect(await decodeShare('hello')).toEqual({ ok: false, error: 'notShare' });
        expect(await decodeShare(SHARE_PREFIX + '1:!!!!')).toEqual({ ok: false, error: 'broken' });
        expect(await decodeShare(t.slice(0, Math.floor(t.length / 2)))).toEqual({ ok: false, error: 'broken' });
        expect(await decodeShare('mogugi-overlay:2:xxx')).toEqual({ ok: false, error: 'newer' });
        const newer = await rawEncode({ settingsV: SETTINGS_VERSION + 1, settings: {}, layouts: {} });
        expect(await decodeShare(newer)).toEqual({ ok: false, error: 'newer' });
        expect(await decodeShare('a'.repeat(1_048_577))).toEqual({ ok: false, error: 'tooBig' });
    });

    it('rejects oversized inflated JSON', async () => {
        const big = await rawEncode({ settingsV: 2, settings: {}, layouts: { pad: 'a'.repeat(2_100_000) } });
        expect(await decodeShare(big)).toEqual({ ok: false, error: 'tooBig' });
    });

    it('falls back to defaults for junk settings', async () => {
        const t = await rawEncode({ settingsV: 2, settings: 5, layouts: [] });
        const r = await decodeShare(t);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const d = defaultOverlaySettings();
        expect(r.payload.settings).toEqual({ ...d, voice: { ...d.voice, voiceName: '' } });
        expect(r.payload.layouts).toEqual({});
        const t2 = await rawEncode({ settingsV: 2, settings: { rules: 'x' }, layouts: null });
        expect((await decodeShare(t2)).ok).toBe(true);
    });

    it('keeps rules from an older settingsV', async () => {
        const rules = defaultOverlaySettings().rules.slice(0, 1);
        const t = await rawEncode({ settingsV: 1, settings: { rules }, layouts: {} });
        const r = await decodeShare(t);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.payload.settings.rules).toEqual(rules);
    });

    it('ignores trailing chatter that looks like token characters', async () => {
        const t = await encodeShare(sample(), L);
        expect((await decodeShare(t + '\nthanks')).ok).toBe(true);
        expect((await decodeShare(t + ' ok 謝謝')).ok).toBe(true);
        const mid = t.slice(0, 50) + '\n' + t.slice(50) + '\nthanks a lot';
        expect((await decodeShare(mid)).ok).toBe(true);
        const long = t + ' thanks for sharing this nice setup with all of us today ok';
        expect((await decodeShare(long)).ok).toBe(true);
    });

    it('uses the real token when chatter mentions the prefix', async () => {
        const t = await encodeShare(sample(), L);
        expect((await decodeShare('用 mogugi-overlay: 開頭貼上\n' + t)).ok).toBe(true);
        expect(await decodeShare('mogugi-overlay:1:!!!! ' + 'mogugi-overlay:2:xxx')).toEqual({ ok: false, error: 'newer' });
    });

    it('bounds the work on pathological whitespace-separated input', async () => {
        const evil = SHARE_PREFIX + '1:' + 'a '.repeat(520_000);
        const t0 = Date.now();
        const r = await decodeShare(evil);
        expect(r.ok).toBe(false);
        expect(Date.now() - t0).toBeLessThan(2000);
        const many = ('mogugi-overlay:1:a a a ').repeat(40_000);
        expect((await decodeShare(many)).ok).toBe(false);
    }, 20_000);

    it('has copy for every error and a dated file name', () => {
        expect(SHARE_ERROR_TEXT.broken).toBe('內容不完整，可能少複製了結尾');
        expect(shareFileName(new Date(2026, 10, 10))).toBe('mogugi-overlay-20261110.txt');
    });
});

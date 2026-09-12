// appSettings.test.ts — settings-tab validation and hint text (vitest, pure logic).
import { describe, it, expect } from 'vitest';
import { validatePort, isDirty, effectHints, saveHints, overrideNote, loadErrorNote, type AppConfig } from './appSettings';

const base: AppConfig = { savePcapng: true, autoOpenBrowser: true, autoPort: false, port: 8030 };

describe('validatePort', () => {
    it('accepts the inclusive range', () => {
        expect(validatePort(1024)).toBeNull();
        expect(validatePort(65535)).toBeNull();
        expect(validatePort(8035)).toBeNull();
    });
    it('rejects out-of-range and non-integers', () => {
        expect(validatePort(1023)).toBe('port 必須在 1024 到 65535 之間');
        expect(validatePort(65536)).toBe('port 必須在 1024 到 65535 之間');
        expect(validatePort(8030.5)).toBe('port 必須是整數');
        expect(validatePort(Number.NaN)).toBe('port 必須是整數');
    });
});

describe('isDirty', () => {
    it('compares the three fields', () => {
        expect(isDirty(base, { ...base })).toBe(false);
        expect(isDirty(base, { ...base, port: 8031 })).toBe(true);
        expect(isDirty(base, { ...base, savePcapng: false })).toBe(true);
        expect(isDirty(base, { ...base, autoOpenBrowser: false })).toBe(true);
    });
});

describe('effectHints', () => {
    it('lists one hint per changed field', () => {
        expect(effectHints({ ...base, savePcapng: false }, base)).toEqual(['保存封包原始紀錄:重新啟動 mogugi 後生效']);
        expect(effectHints({ ...base, autoOpenBrowser: false }, base)).toEqual(['自動開啟瀏覽器:下次啟動生效']);
        expect(effectHints({ ...base, port: 8035 }, base)).toEqual(['port:重啟後請改開 http://127.0.0.1:8035']);
        expect(effectHints(base, base)).toEqual([]);
    });
});

describe('saveHints', () => {
    it('does not duplicate the port line when the port itself changed', () => {
        const hints = saveHints({ ...base, port: 8035 }, base, true);
        expect(hints.filter(h => h.startsWith('port:'))).toHaveLength(1);
        expect(hints).toEqual(['port:重啟後請改開 http://127.0.0.1:8035']);
    });
    it('appends a port hint when only restartRequired is true', () => {
        expect(saveHints(base, base, true)).toEqual(['port:重啟後請改開 http://127.0.0.1:8030']);
    });
    it('adds no port line when nothing requires a restart', () => {
        expect(saveHints(base, base, false)).toEqual([]);
    });
});

describe('notes', () => {
    it('formats override and load-error notes', () => {
        expect(overrideNote('--no-pcap')).toBe('本次執行由啟動參數 --no-pcap 覆寫,設定檔的值仍會保存');
        expect(loadErrorNote('設定檔格式錯誤:x')).toBe('設定檔有問題,已改用預設值:設定檔格式錯誤:x。修好檔案後重啟即可。');
    });
});

describe('autoPort', () => {
    it('isDirty sees autoPort', () => {
        expect(isDirty(base, { ...base, autoPort: true })).toBe(true);
    });
    it('effectHints: autoPort change has its own line; port line only when auto is off', () => {
        expect(effectHints({ ...base, autoPort: true }, base)).toEqual(['自動切換 port:下次啟動生效']);
        expect(effectHints({ ...base, autoPort: true, port: 8035 }, base)).toEqual(['自動切換 port:下次啟動生效']);
        expect(effectHints({ ...base, port: 8035 }, base)).toEqual(['port:重啟後請改開 http://127.0.0.1:8035']);
    });
    it('saveHints: restart with auto on says the port is chosen automatically', () => {
        const on = { ...base, autoPort: true };
        expect(saveHints(on, base, true)).toEqual(['自動切換 port:下次啟動生效', '重啟後 port 由自動切換決定(8030 到 8040)']);
        expect(saveHints(on, on, false)).toEqual([]);
        expect(saveHints(base, on, true)).toEqual(['自動切換 port:下次啟動生效', 'port:重啟後請改開 http://127.0.0.1:8030']);
    });
});

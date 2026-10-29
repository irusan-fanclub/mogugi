// The frontend's settings live in mogugi-config.toml under [battle] and [ui],
// read and written through /api/ui-settings. Callers use the Storage interface
// with the key names below, or loadSetting/saveSetting for plain values. Until
// hydrateSettings() succeeds (tests, chart windows, a missing license), or when
// hydrated read-only (overlay windows), changes stay in memory and are never saved.

type Section = 'battle' | 'ui';
interface Entry { key: string; section: Section; name: string; json: boolean }

const SECTIONS: Section[] = ['battle', 'ui'];

// json: the value is JSON text through the Storage interface and a native TOML value in the file.
const ENTRIES: Entry[] = [
    { key: 'trackedDebuffCCIds', section: 'battle', name: 'bossCC', json: true },
    { key: 'chartHiddenCCIds', section: 'battle', name: 'bossCoverageOnly', json: true },
    { key: 'trackedSelfCCIds', section: 'battle', name: 'selfCC', json: true },
    { key: 'chartHiddenSelfCCIds', section: 'battle', name: 'selfCoverageOnly', json: true },
    { key: 'skillCcModel', section: 'battle', name: 'skillCc', json: true },
    { key: 'config', section: 'battle', name: 'general', json: true },
    { key: 'ccPickMode', section: 'battle', name: 'ccPickMode', json: false },
    { key: 'lastSeenCcDefaults', section: 'battle', name: 'lastSeenCcDefaults', json: false },
    { key: 'overlay', section: 'ui', name: 'overlay', json: true },
    { key: 'recordsColumns', section: 'ui', name: 'recordsColumns', json: true },
    { key: 'itemsColumns', section: 'ui', name: 'itemsColumns', json: true },
    { key: 'equipmentAutoFetch', section: 'ui', name: 'equipmentAutoFetch', json: true },
    { key: 'importBattles', section: 'ui', name: 'importBattles', json: true },
];
const byKey = new Map(ENTRIES.map(e => [e.key, e]));

const SAVE_DELAY_MS = 300;

const emptyTables = (): Record<Section, Record<string, unknown>> => ({ battle: {}, ui: {} });
let tables = emptyTables();
let hydrated = false;
let readOnly = false;
const dirty = new Set<Section>();
let timer = 0;

function entry(key: string): Entry {
    const e = byKey.get(key);
    if (!e) throw new Error(`unknown setting ${key}`);
    return e;
}

function changed(s: Section) {
    if (!hydrated || readOnly) return;
    dirty.add(s);
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(() => { timer = 0; void flushSettings(); }, SAVE_DELAY_MS);
}

/** Writes the changed tables now (also used on page hide, so a pending change is not lost). */
export async function flushSettings(): Promise<void> {
    if (timer) { clearTimeout(timer); timer = 0; }
    if (!hydrated || dirty.size === 0) return;
    const body: Partial<Record<Section, Record<string, unknown>>> = {};
    for (const s of dirty) body[s] = tables[s];
    dirty.clear();
    try {
        await fetch('/api/ui-settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            keepalive: true,
        });
    } catch (e) {
        console.error('save settings failed:', e);
    }
}

/** The stored value, or the fallback when absent or invalid. */
export function loadSetting<T>(key: string, fallback: T, validate: (v: unknown) => v is T): T {
    const e = entry(key);
    const v = tables[e.section][e.name];
    return validate(v) ? v : fallback;
}

export function saveSetting(key: string, value: unknown): void {
    const e = entry(key);
    tables[e.section][e.name] = JSON.parse(JSON.stringify(value));
    changed(e.section);
}

// length/key/clear are not used; only the named keys are readable.
export const settingsStorage: Storage = {
    get length() { return 0; },
    key() { return null; },
    clear() { /* not supported */ },
    getItem(key) {
        const e = entry(key);
        const v = tables[e.section][e.name];
        if (v === undefined || v === null) return null;
        return e.json ? JSON.stringify(v) : String(v);
    },
    setItem(key, value) {
        const e = entry(key);
        try {
            tables[e.section][e.name] = e.json ? JSON.parse(value) : value;
        } catch {
            return;
        }
        changed(e.section);
    },
    removeItem(key) {
        const e = entry(key);
        delete tables[e.section][e.name];
        changed(e.section);
    },
};

/** Loads the tables before the app's modules read their settings; a failure keeps the in-memory ones. */
export async function hydrateSettings(opts: { readOnly?: boolean } = {}): Promise<void> {
    readOnly = opts.readOnly ?? false;
    try {
        const r = await fetch('/api/ui-settings');
        if (!r.ok) return;
        const j = (await r.json()) as Partial<Record<Section, Record<string, unknown>>>;
        tables = emptyTables();
        const stale = new Set<Section>();
        for (const s of SECTIONS) {
            const t = j[s];
            if (!t || typeof t !== 'object' || Array.isArray(t)) continue;
            // Names no entry uses any more are dropped from the file.
            for (const [name, v] of Object.entries(t)) {
                if (ENTRIES.some(e => e.section === s && e.name === name)) tables[s][name] = v;
                else stale.add(s);
            }
        }
        hydrated = true;
        for (const s of stale) changed(s);
    } catch { /* stays in memory */ }
}

/** Test hook: back to unhydrated in-memory tables. */
export function resetSettingsForTest() {
    tables = emptyTables();
    hydrated = false;
    readOnly = false;
    dirty.clear();
    if (timer) { clearTimeout(timer); timer = 0; }
}

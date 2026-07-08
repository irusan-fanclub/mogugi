#!/usr/bin/env node
// Pull mabitsequal SQLite from GitHub release, extract icons to public/icons,
// emit a lean SQLite (id + name only) to public/db.
//
// Cached by upstream sha256 + this script's BUILD_VERSION. Skips work when
// outputs are already current.

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

const BUILD_VERSION = 3;

const REGION = 'tw';
const VER = 'v154';
const TAG = `${REGION}-${VER}`;
const REPO = 'irusan-fanclub/mabitsequal-builds';
const ASSET = `mabi_${REGION}_${VER}.sqlite`;
const SHA_ASSET = `${ASSET}.sha256`;

const FRONT = path.resolve(import.meta.dirname, '..');
const CACHE_DIR = path.join(FRONT, '.cache', 'mabitsequal');
const FULL_SQLITE = path.join(CACHE_DIR, ASSET);
const META_PATH = path.join(FRONT, '.cache', 'build-data-meta.json');

const PUBLIC = path.join(FRONT, 'public');
const OUT_DB = path.join(PUBLIC, 'db', `mabi_${REGION}.sqlite`);
const OUT_ICONS = path.join(PUBLIC, 'icons');

// race has no icon_id column in mabitsequal schema — skipped.
const ICON_SOURCES = [
    { kind: 'skill', table: 'skill', id: 'skill_id' },
    { kind: 'cc',    table: 'character_condition', id: 'condition_id' },
    { kind: 'item',  table: 'item', id: 'item_id' },
    { kind: 'title', table: 'title', id: 'title_id' },
];

// `optional: true` — table may be absent from older upstream sqlites (optionset:
// mabitsequal schema >= 4, metalware_ability: >= 5); emit an empty table then.
// `extra` — additional columns copied verbatim beyond id + name.
const LIST_SOURCES = [
    { dst: 'race',                src: 'race',                id: 'race_id' },
    { dst: 'skill',               src: 'skill',               id: 'skill_id' },
    { dst: 'character_condition', src: 'character_condition', id: 'condition_id' },
    { dst: 'item',                src: 'item',                id: 'item_id' },
    { dst: 'optionset',           src: 'optionset',           id: 'optionset_id', optional: true,
      extra: { level: 'INTEGER', description: 'TEXT' } },
    { dst: 'metalware_ability',   src: 'metalware_ability',   id: 'ability_id',   optional: true,
      nameExpr: 'name',
      extra: { initial_value: 'REAL', value_per_level: 'REAL', base_max_level: 'INTEGER' } },
];

async function exists(p) {
    try { await fs.access(p); return true; } catch { return false; }
}

async function sha256File(p) {
    const h = createHash('sha256');
    const fh = await fs.open(p);
    try {
        for await (const chunk of fh.createReadStream()) h.update(chunk);
    } finally {
        await fh.close();
    }
    return h.digest('hex');
}

async function loadMeta() {
    try { return JSON.parse(await fs.readFile(META_PATH, 'utf8')); }
    catch { return {}; }
}

async function saveMeta(meta) {
    await fs.mkdir(path.dirname(META_PATH), { recursive: true });
    await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2));
}

function ghDownload(asset, destDir) {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.platform === 'win32' ? 'gh.exe' : 'gh',
            [
                'release', 'download', TAG,
                '--repo', REPO,
                '--pattern', asset,
                '--dir', destDir,
                '--clobber',
            ],
            { stdio: 'inherit' },
        );
        child.on('close', code => code === 0 ? resolve() : reject(new Error(`gh exit ${code}`)));
        child.on('error', reject);
    });
}

async function ensureSourceSqlite() {
    const meta = await loadMeta();

    await fs.mkdir(CACHE_DIR, { recursive: true });
    await ghDownload(SHA_ASSET, CACHE_DIR);
    const shaPath = path.join(CACHE_DIR, SHA_ASSET);
    const upstreamSha = (await fs.readFile(shaPath, 'utf8')).trim().split(/\s+/)[0];

    if (meta.upstreamSha === upstreamSha && await exists(FULL_SQLITE)) {
        return { sha: upstreamSha, fetched: false };
    }

    console.log(`[build-data] fetching ${ASSET} (sha=${upstreamSha.slice(0, 12)})...`);
    await ghDownload(ASSET, CACHE_DIR);
    const localSha = await sha256File(FULL_SQLITE);
    if (localSha !== upstreamSha) {
        throw new Error(`sha mismatch: expected ${upstreamSha}, got ${localSha}`);
    }
    console.log(`[build-data] verified ${ASSET}.`);
    return { sha: upstreamSha, fetched: true };
}

async function extractIcons(src) {
    await fs.rm(OUT_ICONS, { recursive: true, force: true });
    await fs.mkdir(OUT_ICONS, { recursive: true });

    for (const { kind, table, id } of ICON_SOURCES) {
        const dir = path.join(OUT_ICONS, kind);
        await fs.mkdir(dir, { recursive: true });

        const rows = src.prepare(
            `SELECT t.${id} AS id, i.image_png AS png
             FROM ${table} t
             JOIN icon i ON t.icon_id = i.icon_id`
        ).all();

        for (const row of rows) {
            await fs.writeFile(path.join(dir, `${row.id}.png`), row.png);
        }
        console.log(`[build-data] wrote ${rows.length} ${kind} icons.`);
    }
}

async function buildLeanDb(src) {
    await fs.mkdir(path.dirname(OUT_DB), { recursive: true });
    await fs.rm(OUT_DB, { force: true });

    const dst = new Database(OUT_DB);
    dst.pragma('journal_mode = OFF');
    dst.pragma('synchronous = OFF');

    dst.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);');
    for (const { dst: dstTable, extra } of LIST_SOURCES) {
        const extraCols = Object.entries(extra ?? {}).map(([c, t]) => `, ${c} ${t}`).join('');
        dst.exec(`CREATE TABLE ${dstTable} (id INTEGER PRIMARY KEY, name TEXT${extraCols});`);
    }

    const metaRows = src.prepare('SELECT key, value FROM meta').all();
    const insertMeta = dst.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
    for (const m of metaRows) insertMeta.run(m.key, m.value);

    const srcHasTable = name => src.prepare(
        `SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`
    ).get(name) !== undefined;

    for (const { dst: dstTable, src: srcTable, id, optional, extra, nameExpr } of LIST_SOURCES) {
        if (optional && !srcHasTable(srcTable)) {
            console.warn(`[build-data] source table '${srcTable}' missing upstream — emitted empty (needs a newer mabitsequal build).`);
            continue;
        }
        const extraCols = Object.keys(extra ?? {});
        const cols = ['id', 'name', ...extraCols];
        const insert = dst.prepare(
            `INSERT INTO ${dstTable} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`
        );
        const selExtra = extraCols.map(c => `, ${c}`).join('');
        const rows = src.prepare(
            `SELECT ${id} AS id, ${nameExpr ?? 'COALESCE(local_name, english_name)'} AS name${selExtra} FROM ${srcTable}`
        ).all();
        const tx = dst.transaction(() => {
            for (const r of rows) insert.run(r.id, r.name, ...extraCols.map(c => r[c]));
        });
        tx();
        console.log(`[build-data] wrote ${rows.length} ${dstTable} rows.`);
    }

    dst.close();

    const size = (await fs.stat(OUT_DB)).size;
    console.log(`[build-data] lean db: ${(size / 1024 / 1024).toFixed(1)} MB`);
}

async function main() {
    const { sha } = await ensureSourceSqlite();
    const outputKey = `${sha}-v${BUILD_VERSION}`;

    const meta = await loadMeta();
    if (
        meta.outputKey === outputKey
        && await exists(OUT_DB)
        && await exists(path.join(OUT_ICONS, 'cc'))
    ) {
        console.log(`[build-data] outputs already current.`);
        return;
    }

    const src = new Database(FULL_SQLITE, { readonly: true });
    try {
        await extractIcons(src);
        await buildLeanDb(src);
    } finally {
        src.close();
    }

    await saveMeta({ upstreamSha: sha, outputKey });
    console.log(`[build-data] done.`);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

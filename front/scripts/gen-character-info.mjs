#!/usr/bin/env node
// Generates src/lib/characterInfo.gen.ts: title names, talent names, the
// grandmaster title per talent, and the arcana exp -> level thresholds.
//
// Regenerate: node front/scripts/gen-character-info.mjs [dataDir]
//
// dataDir defaults to a client extraction's `data/` folder; it must hold
// db/Title.xml, db/talenttitle.xml, db/MultiClassCommon.xml (UTF-16) and
// local/xml/Title.taiwan.txt, local/xml/talenttitle.taiwan.txt (UTF-8 BOM).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DATA = 'D:/Projects/MabinogiProjects/mabi_it_workspace/tw169_extracted/data';
const OUT_PATH = path.resolve(import.meta.dirname, '..', 'src', 'lib', 'characterInfo.gen.ts');

const utf16 = buf => {
    const text = buf.toString('utf16le');
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
};

// "index<TAB>text" lines -> Map(index string -> text).
export function parseLocale(buf) {
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const map = new Map();
    for (const line of text.split(/\r\n|\n/)) {
        const tab = line.indexOf('\t');
        if (tab > 0) map.set(line.slice(0, tab), line.slice(tab + 1));
    }
    return map;
}

const localized = (ref, loc, ns) => {
    const m = ref.match(new RegExp(`_LT\\[xml\\.${ns}\\.(\\d+)\\]`));
    return m ? (loc.get(m[1]) ?? '') : ref;
};

// Title id -> display name. The gendered variants are identical in tw, so the
// first real name of Default/Uni/Male/Female wins ("none" is a placeholder); a repeated id keeps the last.
export function parseTitles(xml, loc) {
    const out = new Map();
    const re = /<Title\b([^>]*)\/>/g;
    let m;
    while ((m = re.exec(xml))) {
        const attr = n => m[1].match(new RegExp(`\\b${n}="([^"]*)"`))?.[1] ?? '';
        const id = Number(attr('ID'));
        const name = ['DefaultName', 'UniName', 'MaleName', 'FemaleName']
            .map(n => localized(attr(n), loc, 'title')).find(s => s && s !== 'none');
        if (id && name) out.set(id, name);
    }
    return out;
}

// Talent id -> { title, name }: the lowest-id level-16 talent title is the
// plain "一代宗師X" one (later ids are job/arcana variants).
export function parseGrandmasters(xml, loc) {
    const best = new Map();
    const re = /<talenttitle\b([^>]*)\/>/g;
    let m;
    while ((m = re.exec(xml))) {
        const attr = n => m[1].match(new RegExp(`\\b${n}="([^"]*)"`))?.[1] ?? '';
        if (attr('talentlevel1') !== '16') continue;
        const talent = Number(attr('talentid1'));
        const title = Number(attr('titleid'));
        const name = localized(attr('localname'), loc, 'talenttitle').replace(/^一代宗師/, '');
        if (!best.has(talent) || title < best.get(talent).title) best.set(talent, { title, name });
    }
    return best;
}

// ClassLevelTable: row `level` holds the exp needed to reach level+1 (the
// last row, level 50, is 0). Returns the thresholds for levels 1..49.
export function parseClassLevels(xml) {
    const rows = [...xml.matchAll(/<ClassLevelTable\s+level="(\d+)"\s+exp="(\d+)"/g)]
        .map(m => [Number(m[1]), Number(m[2])]).sort((a, b) => a[0] - b[0]);
    return rows.filter(([, exp]) => exp > 0).map(([, exp]) => exp);
}

function render({ titles, grandmasters, levels }) {
    const titleBody = [...titles].sort((a, b) => a[0] - b[0])
        .map(([id, name]) => `    ${id}: ${JSON.stringify(name)},`).join('\n');
    const gm = [...grandmasters].sort((a, b) => a[0] - b[0]);
    const gmNames = gm.map(([id, v]) => `    ${id}: ${JSON.stringify(v.name)},`).join('\n');
    const gmTitles = gm.map(([id, v]) => `    ${id}: ${v.title},`).join('\n');
    return `// GENERATED FILE - DO NOT EDIT.
// Regenerate: node front/scripts/gen-character-info.mjs
// Source: Title.xml, talenttitle.xml, MultiClassCommon.xml + their taiwan locale files.

/** Title id -> name (Title.xml). */
export const TITLE_NAMES: Record<number, string> = {
${titleBody}
};

/** Talent id -> name with the 一代宗師 prefix removed (talenttitle.xml). */
export const TALENT_NAMES: Record<number, string> = {
${gmNames}
};

/** Talent id -> its level-16 grandmaster title id (talenttitle.xml). */
export const GRANDMASTER_TITLE_BY_TALENT: Record<number, number> = {
${gmTitles}
};

/** Arcana exp needed to reach level n+1, for n = 1..49 (ClassLevelList). */
export const CLASS_LEVEL_EXP: number[] = [${levels.join(', ')}];
`;
}

function main() {
    const dir = process.argv[2] ?? DEFAULT_DATA;
    const read = p => fs.readFileSync(path.join(dir, p));
    const titles = parseTitles(utf16(read('db/Title.xml')), parseLocale(read('local/xml/Title.taiwan.txt')));
    const grandmasters = parseGrandmasters(utf16(read('db/talenttitle.xml')), parseLocale(read('local/xml/talenttitle.taiwan.txt')));
    const levels = parseClassLevels(utf16(read('db/MultiClassCommon.xml')));
    fs.writeFileSync(OUT_PATH, render({ titles, grandmasters, levels }));
    console.log(`[gen-character-info] ${titles.size} titles, ${grandmasters.size} talents, ${levels.length} level thresholds -> ${OUT_PATH}`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) main();

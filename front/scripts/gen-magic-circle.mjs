#!/usr/bin/env node
// Generates src/lib/magicCircleAbilities.gen.ts: ability id -> raw locale
// template text (e.g. "... [*1]% ... (*1等級)"), for the tooltip/table code
// to substitute against a circle's MCELV level.
//
// Regenerate: node front/scripts/gen-magic-circle.mjs [xmlPath] [localePath]
//
// Sources (paths below are defaults; pass overrides as CLI args):
//   xmlPath:    data/db/MagicCircle/MagicCircleAbility.xml (UTF-16, id -> locale index)
//   localePath: data/local/xml/magiccircleability.taiwan.txt (UTF-8 BOM, CRLF, "index\ttext")

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_XML = 'D:/Projects/MabinogiProjects/mabi_it_workspace/tw165_extracted/data/db/MagicCircle/MagicCircleAbility.xml';
const DEFAULT_LOCALE = 'D:/Projects/MabinogiProjects/mabi_it_workspace/tw165_extracted/data/local/xml/magiccircleability.taiwan.txt';
const OUT_PATH = path.resolve(import.meta.dirname, '..', 'src', 'lib', 'magicCircleAbilities.gen.ts');

// Extracts {id, descIdx} pairs from "<Ability Id="N" .. Desc="_LT[xml.magiccircleability.M]" .../>".
export function parseAbilityXml(buf) {
    let text = buf.toString('utf16le');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const re = /<Ability\b([^>]*)\/>/g;
    const entries = [];
    let m;
    while ((m = re.exec(text))) {
        const idM = m[1].match(/\bId="(\d+)"/);
        const descM = m[1].match(/Desc="_LT\[xml\.magiccircleability\.(\d+)\]"/);
        if (!idM || !descM) continue;
        entries.push({ id: Number(idM[1]), descIdx: Number(descM[1]) });
    }
    return entries;
}

// Parses "index<TAB>text" lines into a descIdx (string) -> text map.
export function parseLocaleText(buf) {
    let text = buf.toString('utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const map = new Map();
    for (const line of text.split(/\r\n|\n/)) {
        if (!line) continue;
        const tab = line.indexOf('\t');
        if (tab < 0) continue;
        map.set(line.slice(0, tab), line.slice(tab + 1));
    }
    return map;
}

// Resolves ability id -> template text. Duplicate ids in the xml keep the
// LAST occurrence (verified against real client data); an id whose final
// occurrence has no resolvable locale text is dropped with a warning.
export function resolveAbilities(entries, localeMap) {
    const idToDescIdx = new Map();
    for (const { id, descIdx } of entries) idToDescIdx.set(id, descIdx);

    const abilities = new Map();
    for (const [id, descIdx] of idToDescIdx) {
        const text = localeMap.get(String(descIdx));
        if (text === undefined) {
            console.warn(`[gen-magic-circle] ability ${id}: no locale text at index ${descIdx}, skipped.`);
            continue;
        }
        abilities.set(id, text);
    }
    return abilities;
}

function render(abilities) {
    const sorted = [...abilities.entries()].sort((a, b) => a[0] - b[0]);
    const body = sorted.map(([id, text]) => `    ${id}: ${JSON.stringify(text)},`).join('\n');
    return `// GENERATED FILE - DO NOT EDIT.
// Regenerate: node front/scripts/gen-magic-circle.mjs
// Source: MagicCircleAbility.xml (ability id -> locale index) +
// magiccircleability.taiwan.txt (locale index -> template text).
// Ability id -> raw template text; "[*N]" tokens mean "N x MCELV" (circle
// level), left intact here for callers (itemTooltip.ts) to substitute.
export const MAGIC_CIRCLE_ABILITIES: Record<number, string> = {
${body}
};
`;
}

function main() {
    const xmlPath = process.argv[2] ?? DEFAULT_XML;
    const localePath = process.argv[3] ?? DEFAULT_LOCALE;

    const entries = parseAbilityXml(fs.readFileSync(xmlPath));
    const localeMap = parseLocaleText(fs.readFileSync(localePath));
    const abilities = resolveAbilities(entries, localeMap);

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, render(abilities));
    console.log(`[gen-magic-circle] wrote ${abilities.size} abilities (from ${entries.length} xml entries) to ${OUT_PATH}`);
}

// Guard direct-run so vitest can import the pure functions above without
// this generating files as a side effect of the import (see build-data.mjs).
const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) main();

#!/usr/bin/env node
// Generates src/lib/skillTags.gen.ts: skills tagged no_cooltime_reset_by_tuairim.
//
// Regenerate: node front/scripts/gen-skill-tags.mjs [SkillInfo.xml]
//
// The path defaults to a client extraction's db/Skill/SkillInfo.xml (UTF-16).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_XML = 'D:/Projects/MabinogiProjects/mabi_it_workspace/tw170_extracted/data/db/Skill/SkillInfo.xml';
const OUT_PATH = path.resolve(import.meta.dirname, '..', 'src', 'lib', 'skillTags.gen.ts');
const TAG = 'no_cooltime_reset_by_tuairim';

const utf16 = buf => {
    const text = buf.toString('utf16le');
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
};

// Sorted unique SkillIDs whose <Skill> StringID attribute holds the tag.
export function parseNoTuairimReset(xml) {
    const ids = new Set();
    for (const m of xml.matchAll(/<Skill\b([^>]*)>/g)) {
        const attr = n => m[1].match(new RegExp(`\\b${n}="([^"]*)"`))?.[1] ?? '';
        const id = Number(attr('SkillID'));
        if (id && attr('StringID').split('/').includes(TAG)) ids.add(id);
    }
    return [...ids].sort((a, b) => a - b);
}

function render(ids) {
    return `// GENERATED FILE - DO NOT EDIT.
// Regenerate: node front/scripts/gen-skill-tags.mjs
// Source: SkillInfo.xml, skills whose StringID has ${TAG}.

/** Skills whose cooldown a 信念值強化 (CC 428) does not reset. */
export const NO_TUAIRIM_RESET: ReadonlySet<number> = new Set([${ids.join(', ')}]);
`;
}

function main() {
    const src = process.argv[2] ?? DEFAULT_XML;
    const ids = parseNoTuairimReset(utf16(fs.readFileSync(src)));
    fs.writeFileSync(OUT_PATH, render(ids));
    console.log(`[gen-skill-tags] ${ids.length} skills -> ${OUT_PATH}`);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) main();

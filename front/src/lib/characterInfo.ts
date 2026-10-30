// characterInfo.ts — rows of the equipment tab's character-info column (pure; no Vue).
import type { ownerPanel, ownerProfile } from '@/protocols';
import { ARCANA_NAMES } from './arcanaTable';
import {
    CLASS_LEVEL_EXP, GRANDMASTER_TITLE_BY_TALENT, TALENT_NAMES, TITLE_NAMES,
} from './characterInfo.gen';

export type Race = 'human' | 'elf' | 'giant';
const RACE_NAMES: Record<Race, string> = { human: '人類', elf: '精靈', giant: '巨人' };
const ARCANA_COUNT: Record<Race, number> = { human: 10, elf: 9, giant: 9 };

export const MAX_LEVEL = 200;
export const MAX_CUMULATED = 40000;
export const MAX_ARCANA_LEVEL = 50;
export const MAX_SYNC_LEVEL = 10;
const NO_GRANDMASTER = 255;
const DASH = '—';

/** CType is a player Race.xml id: 8000-8002 giant, 9000-9002 elf, 10000-10002 human. */
export function raceOf(charType: number): Race | null {
    if (charType >= 8000 && charType <= 8002) return 'giant';
    if (charType >= 9000 && charType <= 9002) return 'elf';
    if (charType >= 10000 && charType <= 10002) return 'human';
    return null;
}

/** Arcana level 1..50 from the accumulated exp (ClassLevelList thresholds). */
export function arcanaLevelOf(exp: number): number {
    let level = 1;
    for (const need of CLASS_LEVEL_EXP) {
        if (exp < need) break;
        level++;
    }
    return level;
}

export type CombatTalent = { id: number; name: string };
// The twelve combat talents, in display order. Giants cannot learn the bow, elves the lance.
const COMBAT_TALENTS: (CombatTalent & { not?: Race })[] = [
    { id: 1, name: '近戰' }, { id: 3, name: '弓術', not: 'giant' }, { id: 2, name: '魔法' },
    { id: 5, name: '戰鬥鍊金術' }, { id: 8, name: '人偶' }, { id: 6, name: '武鬥' },
    { id: 9, name: '騎槍', not: 'elf' }, { id: 10, name: '祝福' }, { id: 7, name: '音樂' },
    { id: 17, name: '雙槍' }, { id: 18, name: '忍者' }, { id: 19, name: '闇夜鎖鏈' },
];

export function combatTalentsFor(race: Race): CombatTalent[] {
    return COMBAT_TALENTS.filter(t => t.not !== race);
}

function talentName(id: number): string {
    return COMBAT_TALENTS.find(t => t.id === id)?.name ?? TALENT_NAMES[id] ?? `#${id}`;
}

const titleName = (id: number): string => id ? (TITLE_NAMES[id] ?? `#${id}`) : '無';

export type InfoState = 'plain' | 'ok' | 'short';
export type InfoRow = {
    label: string;
    value: string;
    state: InfoState;
    /** Talents still to master, 、-joined; only on the last row and only when some are missing. */
    missing?: string;
};

export type CharacterInfoInput = {
    name: string;
    panel: ownerPanel | null;
    profile: ownerProfile | null;
};

const plain = (label: string, value: string | null): InfoRow =>
    ({ label, value: value ?? DASH, state: 'plain' });

// "n/max" coloured by whether n reached the cap; a missing n is a plain dash.
function capped(label: string, n: number | null, max: number, fmt: (v: number) => string = String): InfoRow {
    if (n === null) return plain(label, null);
    return { label, value: `${fmt(n)}/${fmt(max)}`, state: n >= max ? 'ok' : 'short' };
}

const thousands = (v: number) => v.toLocaleString('en-US');

/** Null until some snapshot data exists, so the caller can show the empty hint. */
export function buildCharacterInfo(input: CharacterInfoInput): InfoRow[] | null {
    const { name, panel, profile } = input;
    if (!panel && !profile) return null;

    const race = panel ? raceOf(panel.charType) : null;
    const titles = profile?.titles ?? null;
    const talent = profile?.talent ?? null;
    const multi = profile?.multiClass ?? null;
    const level = panel && panel.level > 0 ? panel.level : null;

    const current = multi?.currentClassId ? multi.classes.find(c => c.classId === multi.currentClassId) : undefined;
    const arcanaTotal = multi ? multi.classes.reduce((s, c) => s + arcanaLevelOf(c.exp), 0) : null;

    const rows: InfoRow[] = [
        plain('角色名稱', name || null),
        plain('種族', race && RACE_NAMES[race]),
        plain('稱號', titles && titleName(titles.titleId)),
        plain('第二稱號', titles && titleName(titles.optionTitleId)),
        plain('當前秘法', multi && (multi.currentClassId ? (ARCANA_NAMES[multi.currentClassId] ?? `#${multi.currentClassId}`) : '無')),
        plain('當前一代宗師', talent && (talent.grandmasterTalentId === NO_GRANDMASTER ? '無' : talentName(talent.grandmasterTalentId))),
        capped('秘法等級', current ? arcanaLevelOf(current.exp) : null, MAX_ARCANA_LEVEL),
        capped('秘法同步等級', current ? current.arcanaLevel : null, MAX_SYNC_LEVEL),
        capped('當前等級', level, MAX_LEVEL),
        capped('累積等級', level && panel ? panel.cumulatedLevel + level : null, MAX_CUMULATED, thousands),
        capped('秘法綜合等級', race && arcanaTotal !== null ? arcanaTotal : null, race ? ARCANA_COUNT[race] * MAX_ARCANA_LEVEL : 0),
    ];

    rows.push(masteryRow(race, talent));
    return rows;
}

function masteryRow(race: Race | null, talent: ownerProfile['talent']): InfoRow {
    const label = '一代宗師戰鬥才能';
    if (!race || !talent) return plain(label, null);
    const owned = new Set(talent.ownedTitleIds);
    // Owning a talent's 一代宗師 title means that talent reached level 16.
    const all = combatTalentsFor(race);
    const lacking = all.filter(t => !owned.has(GRANDMASTER_TITLE_BY_TALENT[t.id]));
    const row: InfoRow = {
        label, value: `${all.length - lacking.length}/${all.length}`, state: lacking.length ? 'short' : 'ok',
    };
    if (lacking.length) row.missing = lacking.map(t => t.name).join('、');
    return row;
}

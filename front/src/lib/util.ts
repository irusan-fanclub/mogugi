import { customRef } from 'vue';
import type { Ref } from 'vue';

import { ActorManager, BaseActor, GroupActor } from '@/eventActor';
import { aliasOf } from './entityAlias';

// Everything is expressed in thousands and up, so a column never mixes a bare
// number with a suffixed one and the digits need no padding to line up.
const NUMBER_SUFFIXES = ['K', 'M', 'B'];

export function humanReadableNumber(n: number): string {
    if (typeof n == 'string') {
        n = parseFloat(n);
    }
    else if (typeof n != 'number') {
        return '0K';
    }

    if (isNaN(n) || !isFinite(n) || n === 0)
        return '0K';

    let value = Math.abs(n) / 1000;
    const sign = n < 0 ? '-' : '';

    // Round before choosing the unit, so 999,999 reads 1.00M rather than
    // 1000.00K. The last suffix absorbs whatever is left.
    let i = 0;
    while (i < NUMBER_SUFFIXES.length - 1 && +value.toFixed(2) >= 1000) {
        value /= 1000;
        i++;
    }

    return sign + value.toFixed(2) + NUMBER_SUFFIXES[i];
}

export function formatDuration(seconds: number): string {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function getMabiNameColor(name: string): string {
    if (!name?.length) {
        return '#808080';
    }

    // https://mabinoger.com/color_sim.htm
    const colCalc = (i: number) => (i * 101) % 97 + 159;

    // if (name.length < 3) {
    //     return '#808080';
    // }

    const ccolor = [0, 0, 0];
    // R = (ASCII Char 1,4,7,10
    // G = (ASCII Char 2,5,8,11
    // B = (ASCII Char 3,6,9,12
    //                          * 101) mod 97) + 159
    for (let i = 0; i < name.length; i++) {
        ccolor[i % 3] += name.charCodeAt(i);
    }
    ccolor[0] = colCalc(ccolor[0]);
    ccolor[1] = colCalc(ccolor[1]);
    ccolor[2] = colCalc(ccolor[2]);

    return '#' + ccolor.map(v => v.toString(16).padStart(2, '0')).join('');
}

// CCs whose game icon is generic/un-recognisable; show a recognisable
// icon (either another CC or the source skill) instead.
const CC_ICON_OVERRIDE: Record<number, { kind: 'skill' | 'cc', id: number }> = {
    323: { kind: 'skill', id: 20018 }, // 傷害詛咒 2 → 憤怒衝擊
    494: { kind: 'cc', id: 23 },       // 無敵 → CC #23
};

export function ccIconUrl(_region: string, ccId: number): string {
    const ov = CC_ICON_OVERRIDE[ccId];
    if (ov?.kind === 'skill') return `/icons/skill/${ov.id}.png`;
    if (ov?.kind === 'cc') return `/icons/cc/${ov.id}.png`;
    return `/icons/cc/${ccId}.png`;
}

// CCs whose in-game name is too long for our compact UI; show a short
// custom label instead. Falls back to condNameMap (with trailing CCId
// stripped) and finally `CC <id>`.
const CC_NAME_OVERRIDE: Record<number, string> = {
    10001: '物防保減少瑪奇魔法陣',
    10002: '魔防保減少瑪奇魔法陣',
    900206: '戰吼',
};

export function ccName(condNameMap: Record<number, string>, ccId: number): string {
    return CC_NAME_OVERRIDE[ccId]
        ?? (condNameMap[ccId] ?? `CC ${ccId}`).replace(/\s*\d+$/, '');
}

/**
 * One shared tick for every actor's and collector's reactivity trigger.
 * Per-instance timers made loading a big log schedule one timer per entity
 * (~1,400 for one real log), each firing its own full recompute cascade —
 * about a minute of a saturated main thread after the load returned. One
 * timer, one batch, one cascade.
 */
const pendingTriggers = new Set<() => void>();
let triggerTimer: ReturnType<typeof setTimeout> | 0 = 0;
const TRIGGER_TICK_MS = 33;

export function scheduleTrigger(fire: () => void): void {
    pendingTriggers.add(fire);
    if (triggerTimer) return;
    triggerTimer = setTimeout(() => {
        triggerTimer = 0;
        const fns = [...pendingTriggers];
        pendingTriggers.clear();
        for (const f of fns) f();
    }, TRIGGER_TICK_MS);
}

export interface IUpdateCallback {
    setUpdateCallback(track: () => void, trigger: () => void): void;
}

export function CustomReactive<T extends IUpdateCallback>(value: T): T {
    const state = customRef<T>((track, trigger) => {
        value.setUpdateCallback(track, trigger);

        return {
            get() {
                track();
                return value;
            },
            set(newValue: T) {
                value = newValue;
                trigger();
            },
        };
    });

    return state.value;
}

export function prettyEntityName(entity: BaseActor | undefined, raceNameMap: Ref<Record<number, string>>): string | undefined {
    if (!entity) {
        return undefined;
    }

    // PC branch also covers a PC's GroupActor, which carries the same name.
    if (ActorManager.pcRaceSet.has(entity.raceId)) {
        return aliasOf(entity.name) ?? entity.name;
    }

    // Placeholder whose real race isn't known yet: race is a stand-in (0), so
    // label by id — otherwise every unknown mob, and its group header, would
    // collapse to the same "unknownRace:0".
    if (entity.raceId === ActorManager.unknownRaceId) {
        return `unknown:${entity.id}`;
    }

    const raceName = raceNameMap.value[entity.raceId] || `unknownRace:${entity.raceId}`;
    if (entity instanceof GroupActor) {
        return raceName;
    }

    // for monster
    if (entity.name[0] >= '0' && entity.name[0] <= '9') {
        return `${raceName} (${entity.name.slice(-4)})`;
    }

    // for pet
    return entity.name;
}
// bossTargetLabel: target-select entry for a boss —
// "yyyy-mm-dd hh:mm:ss name (raceId) -- maxHp". Missing time / hp segments
// are omitted (old records predate the max-life event). raceNameMap values
// carry a trailing " <id>", which would duplicate the (raceId) part.
export function bossTargetLabel(appearAt: number | undefined, raceId: number,
    raceName: string | undefined, maxLife: number | undefined): string {
    const parts: string[] = [];
    if (appearAt !== undefined) parts.push(formatUnixLocal(appearAt));
    parts.push(`${stripRaceSuffix(raceId, raceName)} (${raceId})`);
    if (maxLife !== undefined) parts.push(`-- ${humanReadableNumber(maxLife)}`);
    return parts.join(' ');
}

// bossTitleLabel: screenshot title-bar variant — "time name - hp", no race
// id. Missing segments are omitted.
export function bossTitleLabel(appearAt: number | undefined, raceId: number,
    raceName: string | undefined, maxLife: number | undefined): string {
    const parts: string[] = [];
    if (appearAt !== undefined) parts.push(formatUnixLocal(appearAt));
    parts.push(stripRaceSuffix(raceId, raceName));
    if (maxLife !== undefined) parts.push(`- ${humanReadableNumber(maxLife)}`);
    return parts.join(' ');
}

// raceNameMap values carry a trailing " <id>"; both label forms place the
// id (or nothing) themselves.
function stripRaceSuffix(raceId: number, raceName: string | undefined): string {
    const name = raceName || `unknownRace:${raceId}`;
    return name.endsWith(` ${raceId}`) ? name.slice(0, -`${raceId}`.length - 1) : name;
}

export function formatUnixLocal(at: number): string {
    const d = new Date(at * 1000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
        ` ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// stackLayout: vertical-stack geometry for stitching screenshot canvases —
// overall size plus each block's y offset, with a gap between blocks.
export function stackLayout(sizes: { w: number, h: number }[], gap = 0): { w: number, h: number, ys: number[] } {
    const ys: number[] = [];
    let y = 0;
    let w = 0;
    for (const [i, s] of sizes.entries()) {
        if (i > 0) y += gap;
        ys.push(y);
        y += s.h;
        w = Math.max(w, s.w);
    }
    return { w, h: y, ys };
}

// resolveThemeBackground: Vuetify paints the page background on <body>, so
// an element-level screenshot needs the computed color re-applied or the
// PNG comes out transparent-cornered.
export function resolveThemeBackground(): string {
    for (const el of [document.body, document.documentElement]) {
        const bg = getComputedStyle(el).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') return bg;
    }
    const v = getComputedStyle(document.documentElement)
        .getPropertyValue('--v-theme-background').trim();
    return v ? `rgb(${v})` : '#121212';
}

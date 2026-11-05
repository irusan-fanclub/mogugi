// Pulled-out items: a unit frame `<section>-<key>` holds one item, a group frame
// `<section>-g<n>` holds several, listed in its layout's order.
import type { ComponentId, OverlayLayout, OverlayState } from './overlayProtocol';
import { unitId, type SectionId } from './overlaySections';

export type Layouts = OverlayState['layout'] | undefined;
/** A layout change; `heir` takes over the frames docked under a removed one. */
export type LayoutOp = { save: ComponentId; layout: OverlayLayout } | { remove: ComponentId; heir?: ComponentId };
export type PlaceTarget = { frame: ComponentId; index: number } | { free: OverlayLayout };

const GROUP_MIN_W = 120;

export function isGroupOf(sec: SectionId, id: ComponentId): boolean {
    const m = /^(.+)-g\d+$/.exec(id);
    return !!m && m[1] === sec;
}

export const groupIdsOf = (sec: SectionId, layouts: Layouts): ComponentId[] =>
    Object.keys(layouts ?? {}).filter(id => layouts?.[id] && isGroupOf(sec, id))
        .sort((a, b) => Number(a.slice(sec.length + 2)) - Number(b.slice(sec.length + 2)));

/** A group's members that are still items of the section and have no unit frame of their own. */
export function groupMembers(sec: SectionId, id: ComponentId, layouts: Layouts, keys: readonly string[]): string[] {
    const out: string[] = [];
    for (const k of layouts?.[id]?.order ?? []) {
        if (keys.includes(k) && !out.includes(k) && !layouts?.[unitId(sec, k)]) out.push(k);
    }
    return out;
}

/** The frame an item is drawn in: its unit, the first group listing it, else the section. */
export function frameOfKey(sec: SectionId, key: string, layouts: Layouts): ComponentId {
    if (layouts?.[unitId(sec, key)]) return unitId(sec, key);
    return groupIdsOf(sec, layouts).find(g => layouts?.[g]?.order?.includes(key)) ?? sec;
}

export function nextGroupId(sec: SectionId, layouts: Layouts): ComponentId {
    for (let n = 1; ; n++) if (!layouts?.[`${sec}-g${n}`]) return `${sec}-g${n}`;
}

interface Ctx { sec: SectionId; layouts: Layouts; layoutOf: (id: ComponentId) => OverlayLayout; keys: readonly string[] }

const without = (list: readonly string[], keys: readonly string[]) => list.filter(k => !keys.includes(k));
const insert = (list: string[], at: number, keys: readonly string[]) => {
    list.splice(Math.min(Math.max(at, 0), list.length), 0, ...keys);
    return list;
};
const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/** Takes `keys` out of the frame `from`; a group left with one item turns into that item's unit. */
export function planTakeOut(c: Ctx, keys: readonly string[], from: ComponentId): LayoutOp[] {
    if (from === c.sec) return [];
    if (!isGroupOf(c.sec, from)) return [{ remove: from }];
    const rest = without(groupMembers(c.sec, from, c.layouts, c.keys), keys);
    const lay = c.layoutOf(from);
    if (rest.length === 0) return [{ remove: from }];
    if (rest.length === 1) {
        const solo = unitId(c.sec, rest[0]);
        const { order: _drop, ...plain } = lay;
        return [{ save: solo, layout: plain }, { remove: from, heir: solo }];
    }
    return [{ save: from, layout: { ...lay, order: rest } }];
}

/**
 * Moves `keys` from the frame `from` to a place in a frame (reorder, merge back, join or start a group)
 * or to a unit frame of their own (`free`, one key only).
 */
export function planPlace(c: Ctx & { sectionOrder: readonly string[] }, keys: readonly string[], from: ComponentId, target: PlaceTarget): LayoutOp[] {
    if ('free' in target) {
        const solo = unitId(c.sec, keys[0]);
        if (from === solo) return [{ save: solo, layout: target.free }];
        return [...planTakeOut(c, keys, from), { save: solo, layout: target.free }];
    }
    const { frame, index } = target;
    const listOf = (id: ComponentId) => id === c.sec ? [...c.sectionOrder] : groupMembers(c.sec, id, c.layouts, c.keys);
    if (frame === from) {
        if (frame !== c.sec && !isGroupOf(c.sec, frame)) return [];
        const before = listOf(frame);
        const next = insert(without(before, keys), index, keys);
        return same(before, next) ? [] : [{ save: frame, layout: { ...c.layoutOf(frame), order: next } }];
    }
    const ops = planTakeOut(c, keys, from);
    if (frame === c.sec || isGroupOf(c.sec, frame)) {
        const next = insert(without(listOf(frame), keys), index, keys);
        ops.push({ save: frame, layout: { ...c.layoutOf(frame), order: next } });
        return ops;
    }
    // A unit frame: the two become a new group where the unit stood.
    const host = c.layoutOf(frame);
    const hostKey = frame.slice(c.sec.length + 1);
    const gid = nextGroupId(c.sec, c.layouts);
    const { order: _drop, ...plain } = host;
    ops.push({ save: gid, layout: { ...plain, width: Math.max(host.width, GROUP_MIN_W), order: insert([hostKey], index, keys) } });
    ops.push({ remove: frame, heir: gid });
    return ops;
}

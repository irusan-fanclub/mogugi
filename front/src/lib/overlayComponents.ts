import { groupIdsOf, groupMembers } from './overlayGroups';
import type { ComponentId, OverlayLayout, OverlayState } from './overlayProtocol';
import type { OverlaySettings } from './overlaySettings';
import { itemKey, unitId, type CcItem, type CooldownItem, type SectionId } from './overlaySections';

export type ComponentKind = 'dps' | 'section' | 'unit' | 'group' | 'alerts';

export interface ComponentDef {
    id: ComponentId;
    name: string;
    kind: ComponentKind;
    defaultLayout: OverlayLayout;
    /** Sections and units. */
    section?: SectionId;
    /** Units: the item key. */
    key?: string;
    /** Groups: the member keys in order. */
    keys?: string[];
}

/** Item name for a unit title. */
export type ItemNamer = (section: SectionId, key: string, item: CcItem | CooldownItem) => string;

/** Draw order of the sections. */
export const SECTION_ORDER: readonly SectionId[] = ['ccBoss', 'ccSelf', 'ccParty', 'cooldown', 'burst', 'misc'];
export const COMPONENT_NAMES: Record<SectionId | 'dps' | 'alerts', string> = {
    dps: '簡易戰鬥資訊', ccBoss: 'BOSS CC', ccSelf: '自己 CC', ccParty: '隊伍 CC',
    cooldown: '技能冷卻', burst: '爆發提示', misc: '雜項', alerts: '提醒',
};

const FIXED: Record<'dps' | 'alerts', OverlayLayout> = {
    dps: { enabled: true, anchor: 'tr', x: -24, y: 24, width: 355, maxRows: 8 },
    alerts: { enabled: false, anchor: 'tr', x: -765, y: 33, width: 320, maxRows: 4 },
};

const PRESET: Record<string, OverlayLayout> = {
    ccBoss: { enabled: false, anchor: 'tl', x: 249, y: 107, width: 300, maxRows: 1 },
    ccSelf: { enabled: true, anchor: 'tl', x: 249, y: 232, width: 300, maxRows: 1 },
    ccParty: {
        enabled: true, anchor: 'bl', x: 26, y: -175, width: 300, maxRows: 8,
        order: ['680', '192', '193', '1225', '1150', '1121', '63', '476', '1120', '1122'],
    },
    burst: { enabled: false, anchor: 'tr', x: -966, y: 122, width: 120, maxRows: 1, order: ['900206', '516'] },
    cooldown: { enabled: true, anchor: 'bl', x: 26, y: -38, width: 149, maxRows: 6, order: ['59005', '59143', '59123'] },
    misc: { enabled: true, anchor: 'center', x: 0, y: -309, width: 123, maxRows: 1 },
};
const UNIT: OverlayLayout = { enabled: true, anchor: 'tl', x: 0, y: 0, width: 120, maxRows: 1 };
/** An id with no preset starts in the middle of the screen, where it is easy to find. */
const NEW_WIDGET: OverlayLayout = { enabled: true, anchor: 'center', x: 0, y: 0, width: 260, maxRows: 6 };

const isUnitId = (id: ComponentId) => SECTION_ORDER.some(s => id.startsWith(s + '-'));

export function defaultLayoutOf(id: ComponentId): OverlayLayout {
    if (id === 'dps' || id === 'alerts') return FIXED[id];
    return PRESET[id] ?? (isUnitId(id) ? UNIT : NEW_WIDGET);
}

export const sectionItems = (s: OverlaySettings, sec: SectionId): (CcItem | CooldownItem)[] =>
    sec === 'cooldown' ? s.cooldown.items : s[sec].items;

const labelOf: ItemNamer = (_s, key, item) => ('label' in item && item.label) || key;

/** The fixed sections, then one unit per item that has a stored unit layout. */
export function componentsOf(
    s: OverlaySettings, layouts: OverlayState['layout'] | undefined, nameOf: ItemNamer = labelOf,
): ComponentDef[] {
    const fixed = (id: 'dps' | 'alerts'): ComponentDef =>
        ({ id, name: COMPONENT_NAMES[id], kind: id, defaultLayout: FIXED[id] });
    const sections = SECTION_ORDER.map((sec): ComponentDef =>
        ({ id: sec, name: COMPONENT_NAMES[sec], kind: 'section', defaultLayout: PRESET[sec], section: sec }));
    const units: ComponentDef[] = [];
    for (const sec of SECTION_ORDER) {
        const items = sectionItems(s, sec);
        const keys = items.map(itemKey);
        const name = (key: string) => nameOf(sec, key, items[keys.indexOf(key)]);
        for (const key of keys) {
            const id = unitId(sec, key);
            if (!layouts?.[id]) continue;
            units.push({ id, name: `${COMPONENT_NAMES[sec]}・${name(key)}`, kind: 'unit', defaultLayout: UNIT, section: sec, key });
        }
        for (const id of groupIdsOf(sec, layouts)) {
            const members = groupMembers(sec, id, layouts, keys);
            if (!members.length) continue;
            units.push({
                id, name: `${COMPONENT_NAMES[sec]}・${members.map(name).join('、')}`, kind: 'group', defaultLayout: UNIT, section: sec, keys: members,
            });
        }
    }
    return [fixed('dps'), ...sections, fixed('alerts'), ...units];
}

export function layoutOf(id: ComponentId, stored: OverlayState['layout'] | undefined): OverlayLayout {
    // The BOSS panel takes over the place of the old single CC component.
    const legacy = id === 'ccBoss' ? stored?.cc : undefined;
    const def = defaultLayoutOf(id);
    return stored?.[id] ?? (legacy && { ...legacy, maxRows: def.maxRows }) ?? def;
}

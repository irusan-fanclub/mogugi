import type { ComponentId, OverlayLayout, OverlayState } from './overlayProtocol';

export interface ComponentDef {
    id: ComponentId;
    name: string;
    defaultLayout: OverlayLayout;
}

export const COMPONENTS: readonly ComponentDef[] = [
    { id: 'dps', name: 'DPS', defaultLayout: { enabled: true, anchor: 'tr', x: -24, y: 24, width: 260, maxRows: 8 } },
    { id: 'cc', name: 'CC 監測', defaultLayout: { enabled: true, anchor: 'tl', x: 24, y: 24, width: 300, maxRows: 8 } },
    { id: 'cooldown', name: '技能冷卻', defaultLayout: { enabled: true, anchor: 'bl', x: 24, y: -24, width: 240, maxRows: 6 } },
    { id: 'alerts', name: '提醒', defaultLayout: { enabled: true, anchor: 'center', x: 0, y: -170, width: 320, maxRows: 4 } },
];

export function layoutOf(id: ComponentId, stored: OverlayState['layout'] | undefined): OverlayLayout {
    return stored?.[id] ?? COMPONENTS.find(c => c.id === id)!.defaultLayout;
}

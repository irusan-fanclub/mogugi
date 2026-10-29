// Shared by the main window's chartHub and the chart windows.
export type ChartKind = 'condition' | 'hitlog';
export type ChartSpec =
    | { kind: 'condition'; attackerId: string }
    | { kind: 'hitlog'; attackerId: string; targetId: string; skillId?: number };
export interface ChartOpts { ccId?: number }
export interface ChartHello { id: string; spec: ChartSpec; opts: ChartOpts }
export interface ChartData<P = unknown> { id: string; title: string; version: number; payload: P }
export const EV = {
    open: 'window:open',
    closed: 'window:closed',
    hello: 'chart:hello',
    data: 'chart:data',
    range: 'chart:range',
    mainReady: 'chart:main-ready',
    // main -> charts: the global time range ({min,max} seconds | null), so a cleared filter resets zoom.
    rangeSync: 'chart:range-sync',
    // main -> charts (browser): this hub's page is going away; its charts may rebind.
    hubBye: 'hub:bye',
    // main -> charts (browser): lightweight liveness ping so a chart can notice a crashed hub.
    hubBeat: 'hub:beat',
    // chart -> hubs (browser): {id, keep}; every hub except `keep` drops that chart instance.
    unbind: 'chart:unbind',
} as const;

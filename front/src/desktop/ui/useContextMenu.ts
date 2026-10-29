import { reactive } from 'vue';

export type MenuItem =
    | { label: string; icon?: string; disabled?: boolean; danger?: boolean; action: () => void }
    | 'divider';

export interface ContextMenuState { open: boolean; x: number; y: number; items: MenuItem[] }

// One shared state: a single <DContextMenu> (mounted in DesktopApp) renders it.
const state = reactive<ContextMenuState>({ open: false, x: 0, y: 0, items: [] });

function open(e: MouseEvent, items: MenuItem[]): void {
    e.preventDefault();
    e.stopPropagation();
    state.x = e.clientX;
    state.y = e.clientY;
    state.items = items;
    state.open = true;
}

function close(): void {
    state.open = false;
}

export function useContextMenu() {
    return { open, close, state };
}

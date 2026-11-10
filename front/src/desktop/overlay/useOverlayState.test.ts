vi.mock('@/lib/runtimeEnv', async o => ({ ...(await o<object>()), isDesktop: () => true }));
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Handler = (data: unknown) => void;
const bridge = vi.hoisted(() => ({
    handlers: new Map<string, Handler[]>(),
    emitted: [] as { name: string; data: unknown }[],
}));
vi.mock('@/lib/desktopBridge', () => ({
    onDesktopEvent: async (name: string, cb: Handler) => {
        const list = bridge.handlers.get(name) ?? [];
        list.push(cb);
        bridge.handlers.set(name, list);
        return () => {};
    },
    emitDesktop: async (name: string, data?: unknown) => { bridge.emitted.push({ name, data }); },
}));

import { flushPromises } from '@vue/test-utils';
import { OV } from '@/lib/overlayProtocol';
import { resetOverlayStateForTest, useOverlayState } from './useOverlayState';

const fire = (name: string, data?: unknown) => (bridge.handlers.get(name) ?? []).forEach(h => h(data));
const good = { locked: true, hotkey: 'Ctrl+Alt+L', hotkeyError: '', licensed: true, elevated: true, elevateError: '', hidden: false, visibleHotkey: 'Ctrl+Alt+O', visibleHotkeyError: '', layout: {}, gameFound: true };

beforeEach(() => {
    bridge.handlers.clear();
    bridge.emitted.length = 0;
    resetOverlayStateForTest();
});

describe('useOverlayState', () => {
    it('registers one listener and emits get-state once across callers', async () => {
        useOverlayState();
        useOverlayState();
        await flushPromises();
        expect(bridge.handlers.get(OV.state)).toHaveLength(1);
        expect(bridge.emitted.filter(e => e.name === OV.getState)).toHaveLength(1);
    });

    it('updates on a valid state and ignores an invalid one', async () => {
        const { state } = useOverlayState();
        await flushPromises();
        fire(OV.state, { locked: 'x' });
        expect(state.value).toBeNull();
        fire(OV.state, good);
        expect(state.value).toEqual(good);
        expect(useOverlayState().state.value).toEqual(good);
    });

    it('setters emit the wire payloads', async () => {
        const o = useOverlayState();
        await flushPromises();
        const lay = { enabled: true, anchor: 'tl' as const, x: 24, y: 24, width: 300, maxRows: 6 };
        o.setLocked(false);
        o.setLayout('ccBoss', lay);
        o.setHotkey('Ctrl+Shift+K');
        o.setHidden(true);
        o.replaceLayouts({ dps: lay }, ['old']);
        const before = o.visibleHotkeyAttempts.value;
        o.setVisibleHotkey('Ctrl+Alt+H');
        expect(o.visibleHotkeyAttempts.value).toBe(before + 1);
        const by = (n: string) => bridge.emitted.filter(e => e.name === n).map(e => e.data);
        expect(by(OV.setLocked)).toEqual([{ locked: false }]);
        expect(by(OV.setLayout)).toEqual([{ id: 'ccBoss', layout: lay }]);
        expect(by(OV.replaceLayouts)).toEqual([{ saves: { dps: lay }, removes: ['old'] }]);
        expect(by(OV.setHotkey)).toEqual([{ hotkey: 'Ctrl+Shift+K' }]);
        expect(by(OV.setHidden)).toEqual([{ hidden: true }]);
        expect(by(OV.setVisibleHotkey)).toEqual([{ hotkey: 'Ctrl+Alt+H' }]);
    });
});

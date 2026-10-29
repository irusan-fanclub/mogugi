// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nextTick } from 'vue';

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
        return () => { bridge.handlers.set(name, (bridge.handlers.get(name) ?? []).filter(h => h !== cb)); };
    },
    emitDesktop: async (name: string, data?: unknown) => { bridge.emitted.push({ name, data }); },
}));

import { resetSettingsForTest, settingsStorage } from '@/lib/settingsStorage';
import { OV } from '@/lib/overlayProtocol';
import { selectedTargetId } from '../tabs/battle/battleSelection';
import { overlaySettings, startOverlayLink, updateOverlaySettings } from './overlayLink';

const fire = (name: string, data?: unknown) => (bridge.handlers.get(name) ?? []).forEach(h => h(data));
const emits = (name: string) => bridge.emitted.filter(e => e.name === name).map(e => e.data);

let stop: () => void;
beforeEach(async () => {
    resetSettingsForTest();
    bridge.handlers.clear();
    bridge.emitted.length = 0;
    selectedTargetId.value = '';
    stop = await startOverlayLink();
});
afterEach(() => stop());

describe('overlayLink', () => {
    it('emits overlay:target when the selected target changes', async () => {
        selectedTargetId.value = 't1';
        await nextTick();
        expect(emits(OV.target)).toEqual([{ targetId: 't1' }]);
    });

    it('answers overlay:hello with the target and the settings', () => {
        selectedTargetId.value = 't2';
        bridge.emitted.length = 0;
        fire(OV.hello, {});
        expect(emits(OV.target)).toEqual([{ targetId: 't2' }]);
        expect(emits(OV.settings)).toHaveLength(1);
    });

    it('updateOverlaySettings persists and emits', () => {
        updateOverlaySettings(s => { s.dps.opacity = 33; });
        expect(overlaySettings.value.dps.opacity).toBe(33);
        expect((emits(OV.settings)[0] as { dps: { opacity: number } }).dps.opacity).toBe(33);
        expect(JSON.parse(settingsStorage.getItem('overlay')!).dps.opacity).toBe(33);
    });

    it('stop unregisters the hello listener and the target watch', async () => {
        stop();
        expect(bridge.handlers.get(OV.hello)).toHaveLength(0);
        bridge.emitted.length = 0;
        selectedTargetId.value = 't3';
        await nextTick();
        expect(emits(OV.target)).toEqual([]);
    });
});

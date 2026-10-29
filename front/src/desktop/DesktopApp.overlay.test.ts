// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ref } from 'vue';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';

vi.mock('@wailsio/runtime', () => ({
    Window: { Minimise: vi.fn(), ToggleMaximise: vi.fn(), Close: vi.fn(), IsMaximised: vi.fn(async () => false) },
    Events: { On: vi.fn(), Emit: vi.fn() },
    Browser: { OpenURL: vi.fn() },
}));
vi.mock('@/lib/backendSession', () => ({
    createBackendSession: () => ({
        connected: ref(true), ownerName: ref(''), source: ref(null),
        notice: ref(null), messageBox: ref(null), connect: vi.fn(),
    }),
}));
vi.mock('@/lib/gameData', () => ({ loadNameMaps: async () => {} }));
vi.mock('@/lib/iconFallback', () => ({ installIconFallback: () => () => {} }));
vi.mock('@/lib/runtimeEnv', () => ({ wsUrl: () => 'ws://x/ws', isDesktop: () => true }));
vi.mock('./windows/chartHub', () => ({ startChartHub: vi.fn(async () => () => {}) }));
vi.mock('./overlay/overlayLink', () => ({ startOverlayLink: vi.fn(async () => () => {}) }));
const overlayState = vi.hoisted(() => ({
    state: null as unknown as { value: unknown },
    attempts: null as unknown as { value: number },
    visibleAttempts: null as unknown as { value: number },
    refresh: null as unknown as ReturnType<typeof vi.fn>,
}));
vi.mock('./overlay/useOverlayState', async () => {
    const { ref } = await import('vue');
    overlayState.state = ref(null);
    overlayState.refresh = vi.fn(async () => {});
    overlayState.attempts = ref(0);
    overlayState.visibleAttempts = ref(0);
    return { useOverlayState: () => ({
        state: overlayState.state, refresh: overlayState.refresh,
        hotkeyAttempts: overlayState.attempts, visibleHotkeyAttempts: overlayState.visibleAttempts,
    }) };
});

import DesktopApp from './DesktopApp.vue';
import { startOverlayLink } from './overlay/overlayLink';

let w: VueWrapper | null = null;
afterEach(() => { w?.unmount(); w = null; vi.unstubAllGlobals(); });

const st = (hotkeyError: string, visibleHotkeyError = '') => ({
    locked: true, hotkey: 'Ctrl+Alt+L', hotkeyError, licensed: true, elevated: true, elevateError: '', hidden: false, visibleHotkey: 'Ctrl+Alt+O', visibleHotkeyError, layout: {}, gameFound: true,
});
const count = (s: string) => document.body.textContent?.split(s).length ?? 1;

describe('DesktopApp overlay link', () => {
    it('starts the link when ready and toasts a hotkey error once per distinct text', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ activated: true }) })));
        w = mount(DesktopApp, { attachTo: document.body });
        await flushPromises();
        expect(startOverlayLink).toHaveBeenCalledTimes(1);
        expect(overlayState.refresh).toHaveBeenCalledTimes(1);
        overlayState.state.value = st('快捷鍵已被其他程式占用');
        await flushPromises();
        overlayState.state.value = st('快捷鍵已被其他程式占用');
        await flushPromises();
        expect(count('快捷鍵已被其他程式占用') - 1).toBe(1);
        overlayState.state.value = st('另一個錯誤');
        await flushPromises();
        expect(document.body.textContent).toContain('另一個錯誤');
    });

    it('toasts a repeated identical error after it cleared or after a new setHotkey', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ activated: true }) })));
        w = mount(DesktopApp, { attachTo: document.body });
        await flushPromises();
        const msg = '重複快捷鍵錯誤';
        const base = count(msg);
        overlayState.state.value = st(msg);
        await flushPromises();
        overlayState.state.value = st('');
        await flushPromises();
        overlayState.state.value = st(msg);
        await flushPromises();
        expect(count(msg) - base).toBe(2);
        overlayState.attempts.value++;
        overlayState.state.value = st(msg);
        await flushPromises();
        expect(count(msg) - base).toBe(3);
    });

    it('toasts a show/hide hotkey error on its own, without repeating the lock one', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ activated: true }) })));
        w = mount(DesktopApp, { attachTo: document.body });
        await flushPromises();
        const lock = '鎖定鍵錯誤', vis = '顯示鍵錯誤';
        const lockBase = count(lock), visBase = count(vis);
        overlayState.state.value = st(lock);
        await flushPromises();
        overlayState.visibleAttempts.value++;
        overlayState.state.value = st(lock, vis);
        await flushPromises();
        expect(count(vis) - visBase).toBe(1);
        expect(count(lock) - lockBase).toBe(1);
    });

    it('refreshes the overlay state again when leaving ready (license lapsed)', async () => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        try {
            let activated = true;
            vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ activated }) })));
            w = mount(DesktopApp, { attachTo: document.body });
            await flushPromises();
            const before = overlayState.refresh.mock.calls.length;
            activated = false;
            await vi.advanceTimersByTimeAsync(60_000);
            await flushPromises();
            expect(overlayState.refresh.mock.calls.length).toBe(before + 1);
        } finally {
            vi.useRealTimers();
        }
    });
});

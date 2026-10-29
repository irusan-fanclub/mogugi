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
vi.mock('@/lib/runtimeEnv', () => ({ wsUrl: () => 'ws://x/ws', isDesktop: () => false }));
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
import { startChartHub } from './windows/chartHub';

let w: VueWrapper | null = null;
afterEach(() => { w?.unmount(); w = null; vi.unstubAllGlobals(); });

describe('DesktopApp in the browser', () => {
    it('starts the chart hub but not the overlay link', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ activated: true }) })));
        w = mount(DesktopApp, { attachTo: document.body });
        await flushPromises();
        expect(startChartHub).toHaveBeenCalledTimes(1);
        expect(startOverlayLink).not.toHaveBeenCalled();
        expect(overlayState.refresh).not.toHaveBeenCalled();
    });
});

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
vi.mock('./windows/chartHub', () => ({ startChartHub: vi.fn(() => Promise.reject(new Error('boom'))) }));
vi.mock('./overlay/overlayLink', () => ({ startOverlayLink: vi.fn(async () => () => {}) }));
vi.mock('./overlay/frameRecords', () => ({ startFrameRecords: vi.fn(() => () => {}) }));

import DesktopApp from './DesktopApp.vue';

let w: VueWrapper | null = null;
afterEach(() => { w?.unmount(); w = null; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('DesktopApp chart hub', () => {
    it('logs a failed hub start instead of leaving the rejection unhandled', async () => {
        const err = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ activated: true }) })));
        w = mount(DesktopApp);
        await flushPromises();
        expect(err).toHaveBeenCalledWith('chart hub start failed', expect.any(Error));
    });
});

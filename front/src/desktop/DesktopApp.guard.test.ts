// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
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
vi.mock('./overlay/overlayLink', () => ({ startOverlayLink: vi.fn(async () => () => {}) }));
vi.mock('./overlay/frameRecords', () => ({ startFrameRecords: vi.fn(() => () => {}) }));

// A tab that calls the shared helper, standing in for later real tabs.
vi.mock('./tabs/registry', async () => {
    const { useApiFetch } = await import('./apiFetch');
    const Probe = defineComponent({
        setup() {
            const api = useApiFetch();
            return () => h('button', { 'data-probe': '', onClick: () => api('/api/x').catch(() => {}) }, 'go');
        },
    });
    return {
        TABS: [{ id: 'battle', label: '戰鬥', component: Probe }],
        PINNED_TABS: [{ id: 'settings', label: '設定', icon: 'mdi-cog-outline', component: Probe }],
    };
});

import DesktopApp from './DesktopApp.vue';

let w: VueWrapper | null = null;
afterEach(() => { w?.unmount(); w = null; vi.unstubAllGlobals(); });

describe('apiFetch', () => {
    it('a 403 from an /api call returns the shell to the license screen', async () => {
        let apiStatus = 200;
        vi.stubGlobal('fetch', vi.fn(async (u: string) => u === '/api/license/status'
            ? { ok: true, status: 200, json: async () => ({ activated: true }) }
            : { ok: apiStatus === 200, status: apiStatus, json: async () => ({}) }));
        w = mount(DesktopApp);
        await flushPromises();
        expect(w.find('[data-probe]').exists()).toBe(true);
        apiStatus = 403;
        await w.find('[data-probe]').trigger('click');
        await flushPromises();
        expect(w.find('[data-license-screen]').exists()).toBe(true);
    });
});

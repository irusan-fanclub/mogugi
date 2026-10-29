// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';

vi.mock('@wailsio/runtime', () => ({
    Window: {
        Minimise: vi.fn(), ToggleMaximise: vi.fn(), Close: vi.fn(),
        IsMaximised: vi.fn(async () => false),
    },
    Events: { On: vi.fn(), Emit: vi.fn() },
    Browser: { OpenURL: vi.fn() },
}));

const sessionMock = vi.hoisted(() => ({
    createBackendSession: vi.fn(),
}));
vi.mock('@/lib/backendSession', () => sessionMock);
const loadNameMaps = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('@/lib/gameData', () => ({ loadNameMaps }));
vi.mock('@/lib/iconFallback', () => ({ installIconFallback: vi.fn(() => () => {}) }));
vi.mock('@/lib/runtimeEnv', () => ({ wsUrl: () => 'ws://127.0.0.1:1/ws', isDesktop: () => false }));
vi.mock('./overlay/overlayLink', () => ({ startOverlayLink: vi.fn(async () => () => {}) }));

import { ref } from 'vue';
import DesktopApp from './DesktopApp.vue';

function fakeSession() {
    return {
        connected: ref(true), ownerName: ref(''), source: ref(null),
        notice: ref(null), messageBox: ref(null),
        connect: vi.fn(), clearData: vi.fn(), loadText: vi.fn(),
        reloadFromServer: vi.fn(), loadBattleRecord: vi.fn(),
    };
}

let w: VueWrapper | null = null;
beforeEach(() => {
    sessionMock.createBackendSession.mockReset();
    loadNameMaps.mockClear();
});
afterEach(() => { w?.unmount(); w = null; vi.unstubAllGlobals(); });

function stubStatus(activated: boolean) {
    vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: true, status: 200, json: async () => ({ activated, displayName: 'Tester' }),
    })));
}

describe('DesktopApp', () => {
    it('shows only the license screen and creates no session when not activated', async () => {
        stubStatus(false);
        w = mount(DesktopApp);
        await flushPromises();
        expect(w.find('[data-license-screen]').exists()).toBe(true);
        expect(w.find('[role=tablist]').exists()).toBe(false);
        expect(sessionMock.createBackendSession).not.toHaveBeenCalled();
        expect(loadNameMaps).not.toHaveBeenCalled();
    });

    it('loads name maps, then connects a history session when activated', async () => {
        stubStatus(true);
        const s = fakeSession();
        sessionMock.createBackendSession.mockReturnValue(s);
        w = mount(DesktopApp);
        await flushPromises();
        expect(loadNameMaps).toHaveBeenCalled();
        expect(sessionMock.createBackendSession).toHaveBeenCalledWith({ url: 'ws://127.0.0.1:1/ws?history=1', history: true });
        expect(s.connect).toHaveBeenCalled();
        expect(w.find('[data-license-screen]').exists()).toBe(false);
        expect(w.find('[role=tablist]').exists()).toBe(true);
    });

    it('backend unreachable shows an error with retry, not the license screen', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('refused'); }));
        w = mount(DesktopApp);
        await flushPromises();
        expect(w.find('[data-license-screen]').exists()).toBe(false);
        expect(w.find('[data-boot-error]').text()).toContain('無法連線到本機服務');
        stubStatus(false);
        await w.find('[data-retry]').trigger('click');
        await flushPromises();
        expect(w.find('[data-license-screen]').exists()).toBe(true);
    });

    it('a boot failure after activation shows the error, not the license screen', async () => {
        stubStatus(true);
        loadNameMaps.mockRejectedValueOnce(new Error('maps broke'));
        w = mount(DesktopApp);
        await flushPromises();
        expect(w.find('[data-license-screen]').exists()).toBe(false);
        expect(w.find('[data-boot-error]').text()).toContain('maps broke');
        expect(sessionMock.createBackendSession).not.toHaveBeenCalled();
    });

    it('a failing session creation shows the error', async () => {
        stubStatus(true);
        sessionMock.createBackendSession.mockImplementation(() => { throw new Error('ws broke'); });
        w = mount(DesktopApp);
        await flushPromises();
        expect(w.find('[data-boot-error]').text()).toContain('ws broke');
    });

    it('the periodic status re-check returns to the license screen when it lapses', async () => {
        vi.useFakeTimers();
        try {
            let activated = true;
            vi.stubGlobal('fetch', vi.fn(async () => ({
                ok: true, status: 200, json: async () => ({ activated, displayName: 'T' }),
            })));
            sessionMock.createBackendSession.mockReturnValue(fakeSession());
            w = mount(DesktopApp);
            await flushPromises();
            expect(w.find('[role=tablist]').exists()).toBe(true);
            activated = false;
            await vi.advanceTimersByTimeAsync(60_000);
            await flushPromises();
            expect(w.find('[data-license-screen]').exists()).toBe(true);
            expect(w.find('[role=tablist]').exists()).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });
});

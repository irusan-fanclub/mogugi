// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';

const win = vi.hoisted(() => ({
    Minimise: vi.fn(async () => {}),
    ToggleMaximise: vi.fn(async () => {}),
    Close: vi.fn(async () => {}),
    IsMaximised: vi.fn(async () => false),
}));
const env = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/lib/runtimeEnv', () => ({ isDesktop: () => env.desktop }));
vi.mock('@/lib/desktopBridge', () => ({ desktopWindow: async () => win, emitDesktop: vi.fn(async () => {}) }));

import TitleBar from './TitleBar.vue';

let w: VueWrapper | null = null;
beforeEach(() => { env.desktop = true; Object.values(win).forEach(f => f.mockClear()); });
afterEach(() => { w?.unmount(); w = null; });

const base = { variant: 'main' as const, connected: true, ownerName: '', licenseUser: '', source: null };

describe('TitleBar', () => {
    it('double-clicking the drag area toggles maximise', async () => {
        w = mount(TitleBar, { props: base });
        await w.find('[data-drag]').trigger('dblclick');
        await flushPromises();
        expect(win.ToggleMaximise).toHaveBeenCalledTimes(1);
    });

    it('double-clicking a button area does not', async () => {
        w = mount(TitleBar, { props: base });
        await w.find('[data-nodrag]').trigger('dblclick');
        expect(win.ToggleMaximise).not.toHaveBeenCalled();
    });

    it('window buttons call the runtime', async () => {
        w = mount(TitleBar, { props: base });
        await flushPromises();
        await w.find('[aria-label="最小化"]').trigger('click');
        await w.find('[aria-label="最大化"]').trigger('click');
        await w.find('[aria-label="關閉"]').trigger('click');
        await flushPromises();
        expect(win.Minimise).toHaveBeenCalled();
        expect(win.ToggleMaximise).toHaveBeenCalled();
        expect(win.Close).toHaveBeenCalled();
    });

    it('shows the backend-disconnected text', () => {
        w = mount(TitleBar, { props: { ...base, connected: false } });
        expect(w.text()).toContain('後端未連線');
    });

    it('chart variant shows only the title and window buttons', () => {
        w = mount(TitleBar, { props: { ...base, variant: 'chart', title: '圖表' } });
        expect(w.text()).toContain('圖表');
        expect(w.find('[data-import]').exists()).toBe(false);
        expect(w.findAll('[aria-label="最小化"],[aria-label="最大化"],[aria-label="關閉"]')).toHaveLength(3);
    });

    it('replay hint appears only while replaying and stops the replay', async () => {
        w = mount(TitleBar, { props: base });
        expect(w.find('[data-replay-stop]').exists()).toBe(false);
        await w.setProps({ source: { Mode: 'replay', File: 'a.pcapng', Done: 1, Total: 2, Finished: false, Err: '', Notice: '' } });
        expect(w.text()).toContain('重播中：a.pcapng');
        expect(w.find('[data-replay-stop]').exists()).toBe(true);
    });

    it('window controls sit outside the shrinking replay/status area', async () => {
        w = mount(TitleBar, { props: { ...base, source: { Mode: 'replay', File: 'x'.repeat(200), Done: 1, Total: 2, Finished: false, Err: '', Notice: '' } } });
        const win = w.find('.win');
        expect(win.findAll('[aria-label="最小化"],[aria-label="最大化"],[aria-label="關閉"]')).toHaveLength(3);
        expect(win.element.closest('.mid')).toBeNull();
        expect(win.element.closest('.replay')).toBeNull();
        expect(w.find('.mid').find('[data-replay-hint]').exists()).toBe(true);
        expect(w.find('.right').element.contains(win.element)).toBe(true);
    });

    it('in the browser: no window controls, import menu or stop-replay button', async () => {
        env.desktop = false;
        w = mount(TitleBar, { props: { ...base, source: { Mode: 'replay', File: 'a.pcapng', Done: 1, Total: 2, Finished: false, Err: '', Notice: '' } } });
        await flushPromises();
        expect(w.find('.win').exists()).toBe(false);
        expect(w.findAll('[aria-label="最小化"],[aria-label="最大化"],[aria-label="關閉"]')).toHaveLength(0);
        expect(w.find('[data-import]').exists()).toBe(false);
        expect(w.find('[data-replay-stop]').exists()).toBe(false);
        expect(w.text()).toContain('重播中：a.pcapng');
        await w.find('[data-drag]').trigger('dblclick');
        await flushPromises();
        expect(win.ToggleMaximise).not.toHaveBeenCalled();
    });
});

// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import AboutTab from './AboutTab.vue';

let w: VueWrapper | null = null;
afterEach(() => { w?.unmount(); w = null; document.body.innerHTML = ''; vi.unstubAllGlobals(); });
const q = <T extends HTMLElement>(s: string) => document.querySelector<T>(s)!;

describe('AboutTab', () => {
    it('shows version and credits in both languages', () => {
        w = mount(AboutTab, { attachTo: document.body });
        const t = q('[data-about]').textContent!;
        expect(t).toContain(`v${__APP_VERSION__}`);
        expect(t).toContain('prilus/dilmatulgi');
        expect(t).toContain('Thanks to the original author');
    });
    it('copies the discord link and shows the discord icon', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        w = mount(AboutTab, { attachTo: document.body });
        expect(q('[data-discord] svg.discord-icon')).toBeTruthy();
        q('[data-discord]').click(); await flushPromises();
        expect(writeText).toHaveBeenCalledWith('https://discord.gg/pJQsN4HgsD');
    });
});

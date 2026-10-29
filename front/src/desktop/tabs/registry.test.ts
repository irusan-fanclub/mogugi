// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const env = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/lib/runtimeEnv', () => ({ isDesktop: () => env.desktop }));

beforeEach(() => vi.resetModules());
const SLOW = 20_000;

describe('tab registry', () => {
    it('keeps the overlay tab on the desktop', async () => {
        env.desktop = true;
        const { TABS } = await import('./registry');
        expect(TABS.map(t => t.id)).toContain('overlay');
    }, SLOW);

    it('drops the overlay tab in the browser', async () => {
        env.desktop = false;
        const { TABS } = await import('./registry');
        expect(TABS.map(t => t.id)).not.toContain('overlay');
        expect(TABS.map(t => t.id)).toContain('battle');
    }, SLOW);

    it('pins settings then about with their icons', async () => {
        env.desktop = true;
        const { PINNED_TABS } = await import('./registry');
        expect(PINNED_TABS.map(t => [t.id, t.icon])).toEqual([
            ['settings', 'mdi-cog-outline'], ['about', 'mdi-information-outline'],
        ]);
    }, SLOW);
});

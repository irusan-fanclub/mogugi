// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import DContextMenu from './DContextMenu.vue';
import { useContextMenu } from './useContextMenu';

let w: VueWrapper | null = null;
afterEach(() => { useContextMenu().close(); w?.unmount(); w = null; document.body.innerHTML = ''; vi.restoreAllMocks(); });

const ev = (x: number, y: number) => new MouseEvent('contextmenu', { clientX: x, clientY: y, cancelable: true });
const menuEl = () => document.querySelector<HTMLElement>('[role="menu"]');
const items = () => Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));

describe('useContextMenu / DContextMenu', () => {
    it('click on an item runs its action and closes the menu', async () => {
        w = mount(DContextMenu, { attachTo: document.body });
        const action = vi.fn();
        const e = ev(10, 10);
        useContextMenu().open(e, [{ label: '甲', action }, 'divider', { label: '乙', action: vi.fn() }]);
        await nextTick();
        expect(e.defaultPrevented).toBe(true);
        expect(items().map(i => i.textContent?.trim())).toEqual(['甲', '乙']);
        items()[0].click();
        await nextTick();
        expect(action).toHaveBeenCalledTimes(1);
        expect(menuEl()).toBeNull();
    });

    it('a disabled item does not run and keeps the menu open', async () => {
        w = mount(DContextMenu, { attachTo: document.body });
        const action = vi.fn();
        useContextMenu().open(ev(5, 5), [{ label: '甲', disabled: true, action }]);
        await nextTick();
        items()[0].click();
        await nextTick();
        expect(action).not.toHaveBeenCalled();
        expect(menuEl()).not.toBeNull();
    });

    it('clamps a menu opened at the bottom-right corner into the window', async () => {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(
            { x: 0, y: 0, left: 0, top: 0, right: 160, bottom: 90, width: 160, height: 90, toJSON() { return {}; } });
        w = mount(DContextMenu, { attachTo: document.body });
        useContextMenu().open(ev(window.innerWidth - 2, window.innerHeight - 2), [{ label: '甲', action: vi.fn() }]);
        await flushPromises();
        const el = menuEl()!;
        expect(parseFloat(el.style.left)).toBeLessThanOrEqual(window.innerWidth - 160);
        expect(parseFloat(el.style.top)).toBeLessThanOrEqual(window.innerHeight - 90);
    });

    it('closes on an outside pointerdown and on Esc', async () => {
        w = mount(DContextMenu, { attachTo: document.body });
        const { open } = useContextMenu();
        open(ev(1, 1), [{ label: '甲', action: vi.fn() }]);
        await nextTick();
        document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        await nextTick();
        expect(menuEl()).toBeNull();
        open(ev(1, 1), [{ label: '甲', action: vi.fn() }]);
        await nextTick();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await nextTick();
        expect(menuEl()).toBeNull();
    });

    it('arrow keys and Enter drive the menu, skipping disabled items', async () => {
        w = mount(DContextMenu, { attachTo: document.body });
        const a = vi.fn();
        const b = vi.fn();
        useContextMenu().open(ev(1, 1), [
            { label: '甲', disabled: true, action: a },
            { label: '乙', action: b },
        ]);
        await nextTick();
        const key = async (k: string) => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
            await nextTick();
        };
        await key('ArrowDown');
        await key('Enter');
        expect(a).not.toHaveBeenCalled();
        expect(b).toHaveBeenCalledTimes(1);
    });

    it('caps the height to the window and scrolls', async () => {
        w = mount(DContextMenu, { attachTo: document.body });
        useContextMenu().open(ev(5, 5), [{ label: '甲', action: vi.fn() }]);
        await flushPromises();
        expect(menuEl()!.style.maxHeight).toBe(`${window.innerHeight - 8}px`);
    });

    it('scrolls the keyboard-highlighted item into view', async () => {
        const spy = vi.fn();
        Element.prototype.scrollIntoView = spy;
        w = mount(DContextMenu, { attachTo: document.body });
        useContextMenu().open(ev(5, 5), [{ label: '甲', action: vi.fn() }, { label: '乙', action: vi.fn() }]);
        await flushPromises();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
        await flushPromises();
        expect(spy).toHaveBeenCalled();
        expect(spy.mock.contexts.at(-1)).toBe(items()[1]);
    });
});

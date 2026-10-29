// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { installNativeMenuGuard } from './nativeMenuGuard';

const fire = (el: Element) => {
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e.defaultPrevented;
};

describe('installNativeMenuGuard', () => {
    let off = () => {};
    afterEach(() => { off(); document.body.innerHTML = ''; });

    it('swallows the native menu where nothing handles right-click', () => {
        off = installNativeMenuGuard();
        document.body.innerHTML = '<div><span id="x">a</span></div>';
        expect(fire(document.getElementById('x')!)).toBe(true);
    });
    it('keeps the native menu on editable fields', () => {
        off = installNativeMenuGuard();
        document.body.innerHTML = '<input id="i"><textarea id="t"></textarea><div contenteditable="true"><b id="c">x</b></div>';
        for (const id of ['i', 't', 'c']) expect(fire(document.getElementById(id)!)).toBe(false);
    });
    it('leaves custom menus alone (they already prevented the default)', () => {
        off = installNativeMenuGuard();
        document.body.innerHTML = '<div id="m"></div>';
        let handled = 0;
        document.getElementById('m')!.addEventListener('contextmenu', e => { handled++; e.preventDefault(); });
        expect(fire(document.getElementById('m')!)).toBe(true);
        expect(handled).toBe(1);
    });
    it('stops guarding once uninstalled', () => {
        installNativeMenuGuard()();
        document.body.innerHTML = '<div id="x"></div>';
        expect(fire(document.getElementById('x')!)).toBe(false);
    });
});

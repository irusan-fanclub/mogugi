// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import HotkeyField from './HotkeyField.vue';

let w: VueWrapper | null = null;
afterEach(() => { w?.unmount(); w = null; });

const mountField = () => (w = mount(HotkeyField, { props: { hotkey: 'Ctrl+Alt+L' }, attachTo: document.body }));
const press = async (init: KeyboardEventInit) => {
    await w!.find('button').trigger('keydown', init);
};

describe('HotkeyField', () => {
    it('shows the current hotkey, then the capture prompt after a click', async () => {
        mountField();
        expect(w!.text()).toContain('Ctrl+Alt+L');
        await w!.find('button').trigger('click');
        expect(w!.text()).toContain('請按下新的組合鍵…');
    });

    it('emits setHotkey for a valid combo and stops listening', async () => {
        mountField();
        await w!.find('button').trigger('click');
        await press({ key: 'k', code: 'KeyK', ctrlKey: true, altKey: true });
        expect(w!.emitted('setHotkey')).toEqual([['Ctrl+Alt+K']]);
        expect(w!.text()).not.toContain('請按下新的組合鍵…');
    });

    it('Esc cancels without emitting', async () => {
        mountField();
        await w!.find('button').trigger('click');
        await press({ key: 'Escape', code: 'Escape' });
        expect(w!.emitted('setHotkey')).toBeUndefined();
        expect(w!.text()).toContain('Ctrl+Alt+L');
    });

    it('rejects an invalid combo with a message', async () => {
        mountField();
        await w!.find('button').trigger('click');
        await press({ key: 'k', code: 'KeyK' });
        expect(w!.text()).toContain('需包含 Ctrl 或 Alt，加上英數字或 F1–F12');
        expect(w!.emitted('setHotkey')).toBeUndefined();
    });

    it('ignores a bare modifier press', async () => {
        mountField();
        await w!.find('button').trigger('click');
        await press({ key: 'Control', code: 'ControlLeft', ctrlKey: true });
        expect(w!.text()).toContain('請按下新的組合鍵…');
        expect(w!.text()).not.toContain('需包含');
    });

    it('lets a bare Tab move focus instead of recording it', async () => {
        mountField();
        await w!.find('button').trigger('click');
        const ev = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', cancelable: true });
        w!.find('button').element.dispatchEvent(ev);
        await w!.vm.$nextTick();
        expect(ev.defaultPrevented).toBe(false);
        expect(w!.text()).not.toContain('需包含');
        expect(w!.text()).toContain('Ctrl+Alt+L');
    });

    it('clears the invalid-combo message once the field loses focus', async () => {
        mountField();
        await w!.find('button').trigger('click');
        await press({ key: 'k', code: 'KeyK' });
        expect(w!.text()).toContain('需包含');
        await w!.find('button').trigger('blur');
        expect(w!.text()).not.toContain('需包含');
    });
});

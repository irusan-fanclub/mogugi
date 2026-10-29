// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import DDialog from './DDialog.vue';

let w: VueWrapper | null = null;
afterEach(() => { w?.unmount(); w = null; });

describe('DDialog', () => {
    it('Esc closes', async () => {
        w = mount(DDialog, { props: { modelValue: true, title: 'T' } });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(w.emitted('update:modelValue')![0]).toEqual([false]);
    });
    it('clicking the scrim closes', async () => {
        w = mount(DDialog, { props: { modelValue: true, title: 'T' } });
        (document.body.querySelector('[data-scrim]') as HTMLElement).click();
        expect(w.emitted('update:modelValue')![0]).toEqual([false]);
    });
    it('renders nothing when closed', () => {
        w = mount(DDialog, { props: { modelValue: false, title: 'T' } });
        expect(document.body.querySelector('[data-scrim]')).toBeNull();
    });
});

describe('DDialog fill', () => {
    it('fill prop adds the fill class; default does not', () => {
        w = mount(DDialog, { props: { modelValue: true, title: 'T', fill: true } });
        expect(document.body.querySelector('.d-dialog')!.classList.contains('fill')).toBe(true);
        w.unmount();
        w = mount(DDialog, { props: { modelValue: true, title: 'T' } });
        expect(document.body.querySelector('.d-dialog')!.classList.contains('fill')).toBe(false);
    });
});

describe('DDialog stacking and focus', () => {
    it('Esc closes only the topmost of stacked dialogs', async () => {
        const a = mount(DDialog, { props: { modelValue: true, title: 'A' } });
        const b = mount(DDialog, { props: { modelValue: true, title: 'B' } });
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(b.emitted('update:modelValue')![0]).toEqual([false]);
        expect(a.emitted('update:modelValue')).toBeUndefined();
        a.unmount();
        b.unmount();
    });
    it('moves focus in and restores it on close', async () => {
        const btn = document.createElement('button');
        document.body.appendChild(btn);
        btn.focus();
        w = mount(DDialog, { props: { modelValue: false, title: 'T' }, slots: { default: '<input id="in">' } });
        await w.setProps({ modelValue: true });
        await w.vm.$nextTick();
        expect(document.body.querySelector('.d-dialog')!.contains(document.activeElement)).toBe(true);
        await w.setProps({ modelValue: false });
        expect(document.activeElement).toBe(btn);
        btn.remove();
    });
    it('labels the dialog by its title', () => {
        w = mount(DDialog, { props: { modelValue: true, title: 'Hello' } });
        const d = document.body.querySelector('.d-dialog')!;
        expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toContain('Hello');
    });
});

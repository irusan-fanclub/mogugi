// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import DToast from './DToast.vue';
import { useToast } from './useToast';

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('DToast', () => {
    it('shows text then removes it after ms', async () => {
        vi.useFakeTimers();
        const w = mount(DToast);
        useToast().show('saved', 1000);
        await w.vm.$nextTick();
        expect(document.body.textContent).toContain('saved');
        vi.advanceTimersByTime(1000);
        await w.vm.$nextTick();
        expect(document.body.textContent).not.toContain('saved');
        w.unmount();
    });
});

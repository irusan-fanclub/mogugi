// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import DTooltip from './DTooltip.vue';

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('DTooltip', () => {
    it('appears only after the delay', async () => {
        vi.useFakeTimers();
        const w = mount(DTooltip, { props: { text: 'hello' }, slots: { default: '<button>x</button>' } });
        await w.trigger('mouseenter');
        vi.advanceTimersByTime(149);
        await w.vm.$nextTick();
        expect(document.body.textContent).not.toContain('hello');
        vi.advanceTimersByTime(1);
        await w.vm.$nextTick();
        expect(document.body.textContent).toContain('hello');
        await w.trigger('mouseleave');
        await w.vm.$nextTick();
        expect(document.body.textContent).not.toContain('hello');
        w.unmount();
    });
    it('mouseleave before the delay cancels', async () => {
        vi.useFakeTimers();
        const w = mount(DTooltip, { props: { text: 'hello' }, slots: { default: '<button>x</button>' } });
        await w.trigger('mouseenter');
        await w.trigger('mouseleave');
        vi.advanceTimersByTime(500);
        await w.vm.$nextTick();
        expect(document.body.textContent).not.toContain('hello');
        w.unmount();
    });
});

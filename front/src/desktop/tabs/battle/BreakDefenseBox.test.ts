// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import BreakDefenseBox from './BreakDefenseBox.vue';
import type { CcValueSummary } from '@/lib/ccValues';

const sum = (values: Record<string, string>): CcValueSummary => ({ values, coveragePct: 50 });
const items = (w: ReturnType<typeof mount>) => w.findAll('[data-break-cc]').map(e => [
    Number(e.attributes('data-break-cc')), e.find('.v').text(), e.classes('zero'),
]);

describe('BreakDefenseBox', () => {
    it('shows four zero items when no CCs were seen', () => {
        const w = mount(BreakDefenseBox, { props: { values: new Map() } });
        expect(w.find('.t').text()).toBe('破防保最高');
        expect(items(w)).toEqual([[1164, '0', true], [1166, '0', true], [1165, '0', true], [1176, '0', true]]);
        expect(w.findAll('img')).toHaveLength(4);
    });

    it('shows each CC separately at its highest value', () => {
        const values = new Map([
            [1164, sum({ MCDDPV: '28', MCDDDV: '103' })],
            [1166, sum({ MCDDMBPV: '61' })],
            [1176, sum({ SBPD: '21' })],
        ]);
        const w = mount(BreakDefenseBox, { props: { values } });
        expect(items(w)).toEqual([[1164, '−28', false], [1166, '+61%', false], [1165, '0', true], [1176, '−21', false]]);
    });

    it('opens the CC tooltip on hover, 這場沒有觸發 when never seen', async () => {
        vi.useFakeTimers();
        try {
            const w = mount(BreakDefenseBox, { props: { values: new Map([[1164, sum({ MCDDPV: '28' })]]) }, attachTo: document.body });
            await w.find('[data-break-cc="1165"]').trigger('mouseenter');
            vi.advanceTimersByTime(300);
            await w.vm.$nextTick();
            expect(document.body.querySelector('.cc-tip .none')?.textContent).toBe('這場沒有觸發');
            await w.find('[data-break-cc="1165"]').trigger('mouseleave');
            await w.find('[data-break-cc="1164"]').trigger('mouseenter');
            vi.advanceTimersByTime(300);
            await w.vm.$nextTick();
            expect(document.body.querySelector('.cc-tip .n')?.textContent).toBe('−28');
            w.unmount();
        } finally { vi.useRealTimers(); }
    });
});

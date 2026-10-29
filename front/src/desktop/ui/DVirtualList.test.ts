// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import DVirtualList from './DVirtualList.vue';

const items = Array.from({ length: 10000 }, (_, i) => ({ n: i }));
const mk = () => mount(DVirtualList, {
    props: { items, itemHeight: 64, height: 640 },
    slots: { default: '<template #default="{ item }"><span class="row">{{ item.n }}</span></template>' },
});

describe('DVirtualList', () => {
    it('renders only a window of 10000 rows', () => {
        const w = mk();
        const rows = w.findAll('.row');
        expect(rows.length).toBeGreaterThan(9);
        expect(rows.length).toBeLessThan(30);
        expect(rows[0].text()).toBe('0');
    });
    it('shows the last item when scrolled to the bottom', async () => {
        const w = mk();
        const el = w.find('[data-vlist]').element as HTMLElement;
        el.scrollTop = 10000 * 64 - 640;
        await w.find('[data-vlist]').trigger('scroll');
        await nextTick();
        const rows = w.findAll('.row');
        expect(rows.length).toBeLessThan(30);
        expect(rows[rows.length - 1].text()).toBe('9999');
    });
    it('exposes the full scroll height', () => {
        const w = mk();
        expect((w.find('[data-vlist-spacer]').element as HTMLElement).style.height).toBe('640000px');
    });
    it('renders nothing for an empty list', () => {
        const w = mount(DVirtualList, { props: { items: [], itemHeight: 64, height: 640 } });
        expect(w.findAll('[data-vlist-row]')).toHaveLength(0);
    });
});

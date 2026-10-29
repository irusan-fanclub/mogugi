// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mount, flushPromises, VueWrapper } from '@vue/test-utils';
import TabBar from './TabBar.vue';

const tabs = [
    { id: 'battle', label: '戰鬥' },
    { id: 'records', label: '紀錄' },
    { id: 'characters', label: '角色' },
    { id: 'items', label: '物品' },
    { id: 'equipment', label: '裝備' },
];
const pinned = [
    { id: 'settings', label: '設定', icon: 'mdi-cog-outline' },
    { id: 'about', label: '關於', icon: 'mdi-information-outline' },
];

let w: VueWrapper | null = null;
let widthSpy: ReturnType<typeof vi.spyOn>;
let clientSpy: ReturnType<typeof vi.spyOn>;

function setWidth(px: number) {
    widthSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(60);
    clientSpy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(px);
}

afterEach(() => { w?.unmount(); w = null; widthSpy?.mockRestore(); clientSpy?.mockRestore(); });

const visibleIds = (x: VueWrapper) => x.findAll('[role=tab]').map(e => e.attributes('data-tab'));

describe('TabBar', () => {
    it('shows everything and no more-button when wide enough', async () => {
        setWidth(800);
        w = mount(TabBar, { props: { tabs, pinned, modelValue: 'battle' } });
        await flushPromises();
        expect(visibleIds(w)).toEqual(['battle', 'records', 'characters', 'items', 'equipment', 'settings', 'about']);
        expect(w.find('[data-more]').exists()).toBe(false);
    });

    it('collapses into the more menu at 200px and keeps the selection visible', async () => {
        setWidth(200);
        w = mount(TabBar, { props: { tabs, pinned, modelValue: 'items' } });
        await flushPromises();
        expect(w.find('[data-more]').exists()).toBe(true);
        expect(visibleIds(w)).toContain('items');
        expect(visibleIds(w)).toContain('settings');
        expect(visibleIds(w)).toContain('about');
        expect(visibleIds(w)).not.toContain('equipment');
    });

    it('picking a tab from the more menu emits the selection', async () => {
        setWidth(200);
        w = mount(TabBar, { props: { tabs, pinned, modelValue: 'battle' } });
        await flushPromises();
        await w.find('[data-more]').trigger('click');
        await w.find('[data-menu-tab="equipment"]').trigger('click');
        expect(w.emitted('update:modelValue')!.at(-1)).toEqual(['equipment']);
    });

    it('renders the pinned tabs as icon buttons with titles', () => {
        w = mount(TabBar, { props: { tabs, pinned, modelValue: 'battle' } });
        const about = w.find('[data-tab=about]');
        expect(about.find('i.mdi-information-outline').exists()).toBe(true);
        expect(about.attributes('title')).toBe('關於');
        expect(w.find('[data-tab=settings] i.mdi-cog-outline').exists()).toBe(true);
    });
});

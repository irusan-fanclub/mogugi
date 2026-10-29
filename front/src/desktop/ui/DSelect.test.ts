// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import DSelect from './DSelect.vue';

const items = [
    { value: '', title: '全部' },
    { value: 'a', title: '甲' },
    { value: 'b', title: '乙' },
];
let w: VueWrapper | null = null;
afterEach(() => { w?.unmount(); w = null; document.body.innerHTML = ''; });

const mountSel = (props: Record<string, unknown> = {}, slots: Record<string, string> = {}) =>
    (w = mount(DSelect, { props: { modelValue: 'a', items, ...props }, slots, attachTo: document.body }));
const box = () => document.querySelector<HTMLElement>('[data-select-box]')!;
const opts = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));

describe('DSelect', () => {
    it('shows the selected title and opens on click', async () => {
        mountSel();
        expect(box().textContent).toContain('甲');
        expect(opts()).toHaveLength(0);
        box().click();
        await nextTick();
        expect(opts().map(o => o.textContent?.trim())).toEqual(['全部', '甲', '乙']);
    });

    it('picking an option emits the value and closes', async () => {
        mountSel();
        box().click();
        await nextTick();
        opts()[2].click();
        await nextTick();
        expect(w!.emitted('update:modelValue')![0]).toEqual(['b']);
        expect(opts()).toHaveLength(0);
    });

    it('a button inside the item slot does not close the menu or select', async () => {
        let hits = 0;
        mountSel({}, {
            item: '<template #item="{ item }">{{ item.title }}<button data-extra type="button">x</button></template>',
        });
        box().click();
        await nextTick();
        const extra = document.querySelector<HTMLButtonElement>('[data-extra]')!;
        extra.addEventListener('click', () => hits++);
        extra.click();
        await nextTick();
        expect(hits).toBe(1);
        expect(opts()).toHaveLength(3);
        expect(w!.emitted('update:modelValue')).toBeUndefined();
    });

    it('clearable emits an empty string', async () => {
        mountSel({ clearable: true });
        document.querySelector<HTMLElement>('[data-clear]')!.click();
        await nextTick();
        expect(w!.emitted('update:modelValue')![0]).toEqual(['']);
    });

    it('arrow keys, Enter and Esc work inside the menu', async () => {
        mountSel({ modelValue: '' });
        const key = async (k: string) => {
            box().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
            await nextTick();
        };
        await key('ArrowDown'); // opens, highlight on the selected item
        expect(opts()).toHaveLength(3);
        await key('ArrowDown');
        await key('Enter');
        expect(w!.emitted('update:modelValue')![0]).toEqual(['a']);
        expect(opts()).toHaveLength(0);
        await key('ArrowDown');
        expect(opts()).toHaveLength(3);
        await key('Escape');
        expect(opts()).toHaveLength(0);
    });

    it('renders the footer slot', async () => {
        mountSel({}, { footer: '<span data-foot>f</span>' });
        box().click();
        await nextTick();
        expect(document.querySelector('[data-foot]')).not.toBeNull();
    });

    it('searchable filters items by title', async () => {
        mountSel({ searchable: true });
        box().click();
        await nextTick();
        const input = document.querySelector<HTMLInputElement>('[data-select-box] input')!;
        input.value = '乙';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await nextTick();
        expect(opts().map(o => o.textContent?.trim())).toEqual(['乙']);
    });

    it('allowCustom commits free text on Enter', async () => {
        mountSel({ modelValue: '50', items: [{ value: '50', title: '50' }], allowCustom: true });
        const input = document.querySelector<HTMLInputElement>('[data-select-box] input')!;
        input.value = '123';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await nextTick();
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        await nextTick();
        expect(w!.emitted('update:modelValue')!.at(-1)).toEqual(['123']);
    });

    describe('menuSearch', () => {
        const many = [
            { value: '1', title: '雷楠的米勒', short: '米勒' },
            { value: '2', title: '艾米' },
            { value: '3', title: '甲' },
        ];
        const search = () => document.querySelector<HTMLInputElement>('[data-menu-search]')!;
        const type = async (v: string) => {
            search().value = v;
            search().dispatchEvent(new Event('input', { bubbles: true }));
            await nextTick();
        };
        const key = async (k: string) => {
            search().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
            await nextTick();
        };
        const open = async () => { mountSel({ modelValue: '3', items: many, menuSearch: true }); box().click(); await nextTick(); await nextTick(); };

        it('shows short when closed and a plain box activator', async () => {
            mountSel({ modelValue: '1', items: many, menuSearch: true });
            expect(box().textContent).toContain('米勒');
            expect(box().textContent).not.toContain('雷楠');
            expect(box().querySelector('input')).toBeNull();
        });

        it('focuses the search input on open and shows the counter', async () => {
            await open();
            expect(document.activeElement).toBe(search());
            expect(document.querySelector('[data-menu-count]')!.textContent).toBe('3 / 3');
        });

        it('filters by title substring and updates the counter', async () => {
            await open();
            await type('米');
            expect(opts().map(o => o.textContent?.trim())).toEqual(['雷楠的米勒', '艾米']);
            expect(document.querySelector('[data-menu-count]')!.textContent).toBe('2 / 3');
        });

        it('passes query to the item slot', async () => {
            mountSel({ modelValue: '3', items: many, menuSearch: true }, {
                item: '<template #item="{ item, query }">{{ item.title }}|{{ query }}</template>',
            });
            box().click();
            await nextTick(); await nextTick();
            await type('米');
            expect(opts()[0].textContent).toContain('|米');
        });

        it('no match shows the empty text, 0 / N, and Enter keeps the model', async () => {
            await open();
            await type('zzz');
            expect(document.body.textContent).toContain('無符合項目');
            expect(document.querySelector('[data-menu-count]')!.textContent).toBe('0 / 3');
            await key('Enter');
            expect(w!.emitted('update:modelValue')).toBeUndefined();
        });

        it('arrows and Enter pick from the search input', async () => {
            await open();
            await type('米');
            await key('ArrowDown');
            await key('Enter');
            expect(w!.emitted('update:modelValue')![0]).toEqual(['2']);
            expect(opts()).toHaveLength(0);
        });

        it('returns focus to the box after Enter picks from the search input', async () => {
            await open();
            await type('米');
            await key('Enter');
            await nextTick();
            expect(document.activeElement).toBe(box());
        });

        it('Esc clears the query first, then closes, and the query resets on reopen', async () => {
            await open();
            await type('米');
            await key('Escape');
            expect(search().value).toBe('');
            expect(opts()).toHaveLength(3);
            await key('Escape');
            expect(opts()).toHaveLength(0);
            box().click();
            await nextTick(); await nextTick();
            expect(search().value).toBe('');
        });
    });
});

// @vitest-environment happy-dom
vi.mock('@/lib/runtimeEnv', async o => ({ ...(await o<object>()), isDesktop: () => true }));
import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushPromises, mount, VueWrapper } from '@vue/test-utils';

const emitted = vi.hoisted(() => [] as { name: string; data: unknown }[]);
vi.mock('@/lib/desktopBridge', () => ({
    onDesktopEvent: async () => () => {},
    emitDesktop: async (name: string, data?: unknown) => { emitted.push({ name, data }); },
}));

import HitLogView from './HitLogView.vue';
import { useToast } from '@/desktop/ui/useToast';
import type { HitLogHit } from '@/desktop/windows/hitlogPayload';

const hit = (n: number, over: Partial<HitLogHit> = {}): HitLogHit => ({
    at: n, skillIcon: '/icons/skill/1.png', skillName: `S${n}`, damage: '1.50K', crit: false, delayed: false,
    cond: [{ id: 5, name: 'Five' }], targetCond: [{ id: 9, name: 'Nine' }], ...over,
});
const data = (hits: HitLogHit[]) => ({ id: 'h', title: 't', version: 1, payload: { header: 'p1 -> All', hits } });

let w: VueWrapper | null = null;
afterEach(() => { w?.unmount(); w = null; emitted.length = 0; document.body.innerHTML = ''; });

const mk = (hits: HitLogHit[]) => mount(HitLogView, {
    attachTo: document.body,
    props: { spec: { kind: 'hitlog', attackerId: 'p1', targetId: '' }, data: data(hits), opts: {} },
});

describe('HitLogView', () => {
    it('shows the header and a window of a long list at 64 px rows', () => {
        w = mk(Array.from({ length: 10000 }, (_, i) => hit(i)));
        expect(w.find('.head').text()).toBe('p1 -> All');
        const rows = w.findAll('[data-vlist-row]');
        expect(rows.length).toBeLessThan(40);
        expect((rows[0].element as HTMLElement).style.height).toBe('64px');
    });

    it('renders skill, damage, flags and both status lists', () => {
        w = mk([hit(1, { crit: true, delayed: true })]);
        const row = w.find('[data-hit]');
        expect(row.text()).toContain('S1');
        expect(row.text()).toContain('1.50K');
        expect(row.text()).toContain('Critical');
        expect(row.text()).toContain('Additional Damage');
        expect(row.findAll('[data-cc]').map(i => i.attributes('title'))).toEqual(['Five', 'Nine']);
    });



    it('right-click copies "skill damage" and toasts', async () => {
        const writeText = vi.fn(async () => {});
        Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
        w = mk([hit(3)]);
        await w.find('[data-hit]').trigger('contextmenu');
        await flushPromises();
        const item = Array.from(document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(e => e.textContent?.includes('複製'));
        expect(item).toBeTruthy();
        item!.click();
        await flushPromises();
        expect(writeText).toHaveBeenCalledWith('S3 1.50K');
        expect(useToast().items.some(t => t.text === '已複製')).toBe(true);
    });

    it('waits for the main window before any data', () => {
        w = mount(HitLogView, { props: { data: null } });
        expect(w.text()).toContain('等待主視窗');
    });

    describe('following the latest hit', () => {
        const box = (el: HTMLElement) => {
            Object.defineProperty(el, 'clientHeight', { configurable: true, value: 400 });
            Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => el.querySelector<HTMLElement>('[data-vlist-spacer]')!.style.height.replace('px', '') as unknown as number });
        };
        const many = (n: number) => Array.from({ length: n }, (_, i) => hit(i));

        it('opens at the newest hit and follows new hits while at the bottom', async () => {
            w = mk(many(100));
            await flushPromises();
            const el = w.find('[data-vlist]').element as HTMLElement;
            expect(el.scrollTop).toBe(99 * 64);
            box(el);
            el.scrollTop = 100 * 64 - 400;
            await w.setProps({ data: data(many(110)) });
            await flushPromises();
            expect(el.scrollTop).toBe(109 * 64);
        });

        it('does not yank the user down after they scrolled up', async () => {
            w = mk(many(100));
            await flushPromises();
            const el = w.find('[data-vlist]').element as HTMLElement;
            box(el);
            el.scrollTop = 1000;
            await w.setProps({ data: data(many(110)) });
            await flushPromises();
            expect(el.scrollTop).toBe(1000);
        });
    });
});

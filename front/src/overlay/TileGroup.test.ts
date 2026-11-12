// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import TileGroup from './TileGroup.vue';
import type { TileVM } from '@/lib/overlayTiles';

const tile = (o: Partial<TileVM> = {}): TileVM => ({
    key: 'c1164', holderId: 'h', label: 'L', icon: { kind: 'cc', id: 1164 }, sec: '12',
    state: 'ok', hl: false, faint: false, mask: 0, isSelf: false,
    itemLabel: '', holderName: '', fixedLabel: false, ...o,
});
const props = (tiles: TileVM[], o: Record<string, unknown> = {}) =>
    ({ tiles, px: 36, dim: 40, editing: false, lifted: null, insertAt: null, ...o });

describe('TileGroup', () => {
    it('renders one tile per VM with the icon url by kind', () => {
        const w = mount(TileGroup, { props: props([tile(), tile({ key: 's1', icon: { kind: 'skill', id: 59005 } })]) });
        const imgs = w.findAll('.ov-tile img');
        expect(imgs.map(i => i.attributes('src'))).toEqual(['/icons/cc/1164.png', '/icons/skill/59005.png']);
        expect(w.findAll('.ov-tile')[0].attributes('data-tile-key')).toBe('c1164');
    });

    it('faint tiles take the dim opacity', () => {
        const w = mount(TileGroup, { props: props([tile({ faint: true })]) });
        expect(w.find('.ov-tile').attributes('style')).toContain('opacity: 0.4');
    });

    it('state classes: hl warn, gone, ready', () => {
        const w = mount(TileGroup, { props: props([
            tile({ state: 'warn', hl: true }), tile({ state: 'warn', hl: false }),
            tile({ state: 'gone', hl: true }), tile({ state: 'ready', sec: 'OK' }),
        ]) });
        const ts = w.findAll('.ov-tile');
        expect(ts[0].classes()).toContain('warn');
        expect(ts[1].classes()).not.toContain('warn');
        expect(ts[2].classes()).toContain('gone');
        expect(ts[3].classes()).toContain('ready');
        expect(ts[3].text()).toContain('OK');
    });

    it('omits the label element when empty', () => {
        const w = mount(TileGroup, { props: props([tile({ label: '' })]) });
        expect(w.find('.ov-lbl').exists()).toBe(false);
    });

    it('emits tile-down only while editing', async () => {
        const w = mount(TileGroup, { props: props([tile()]) });
        await w.find('.ov-tile').trigger('pointerdown');
        expect(w.emitted('tile-down')).toBeUndefined();
        await w.setProps({ editing: true });
        await w.find('.ov-tile').trigger('pointerdown');
        expect(w.emitted('tile-down')![0][0]).toBe('c1164');
    });

    it('hides lifted tiles and draws the insertion bar before the keyed item', () => {
        const ts = [tile({ key: 'a' }), tile({ key: 'a', holderId: 'x' }), tile({ key: 'b' }), tile({ key: '1164' })];
        const w = mount(TileGroup, { props: props(ts, { lifted: '1164', insertAt: 1 }) });
        expect(w.findAll('.ov-tile').map(t => t.attributes('data-tile-key'))).toEqual(['a', 'a', 'b']);
        const kids = Array.from((w.element as Element).children);
        expect(kids[2].classList.contains('ov-ins')).toBe(true);
        expect(kids[3].getAttribute('data-tile-key')).toBe('b');
    });

    it('draws the bar at the end when insertAt is past the last key', () => {
        const w = mount(TileGroup, { props: props([tile({ key: 'a' })], { insertAt: 1 }) });
        expect(Array.from((w.element as Element).children).at(-1)!.classList.contains('ov-ins')).toBe(true);
    });
});

// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import AlertsOverlay from './AlertsOverlay.vue';
import { defaultOverlaySettings } from '@/lib/overlaySettings';

const settings = defaultOverlaySettings().alerts;
const meta = { at: 0, ruleId: 'r', actorId: 'a', castKey: '', expireAt: 0 };
const items = [{ key: 1, text: '舊', ...meta }, { key: 2, text: '新', ...meta }];
const texts = (anchor: 'bl' | 'br' | 'tl' | 'tr' | 'center') =>
    mount(AlertsOverlay, { props: { items, settings, anchor, maxRows: 4 } }).findAll('[data-alert]').map(a => a.text());

describe('AlertsOverlay', () => {
    it('bottom anchors put the newest at the bottom', () => {
        expect(texts('bl')).toEqual(['舊', '新']);
        expect(texts('br')).toEqual(['舊', '新']);
    });

    it('other anchors put the newest on top', () => {
        for (const a of ['tl', 'tr', 'center'] as const) expect(texts(a)).toEqual(['新', '舊']);
    });

    it('shows only the newest maxRows', () => {
        const many = [1, 2, 3, 4, 5].map(k => ({ key: k, text: `m${k}`, ...meta }));
        const w = mount(AlertsOverlay, { props: { items: many, settings, anchor: 'tl', maxRows: 2 } });
        expect(w.findAll('[data-alert]').map(a => a.text())).toEqual(['m5', 'm4']);
    });

    it('a loud alert gets the loud class', () => {
        const w = mount(AlertsOverlay, { props: { items: [{ key: 1, text: '覺醒', ...meta, loud: true }, items[0]], settings, anchor: 'bl', maxRows: 4 } });
        expect(w.findAll('[data-alert]').map(a => a.classes().includes('loud'))).toEqual([true, false]);
    });
});

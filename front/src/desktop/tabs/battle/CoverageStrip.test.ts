// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import CoverageStrip from './CoverageStrip.vue';
import source from './CoverageStrip.vue?raw';
import { GROUP_LABEL_FONT, GROUP_LABEL_X, ICON_LEFT } from '../../charts/dpsTimelineOption';

const row = (ccId: number, onChart = true) => ({ ccId, pct: 50, color: 'warn' as const, onChart });

describe('CoverageStrip', () => {
    it('renders each group with its label and omits empty groups', () => {
        const w = mount(CoverageStrip, {
            props: {
                groups: [
                    { label: 'BOSS', rows: [row(1), row(2, false)] },
                    { label: '自身', rows: [row(516)] },
                    { label: '空', rows: [] },
                ],
            },
        });
        const t = w.text();
        expect(t).toContain('BOSS');
        expect(t).toContain('自身');
        expect(t).not.toContain('空');
        expect(w.findAll('.strip')).toHaveLength(2);
        expect(w.findAll('.cells')).toHaveLength(3);
    });

    it('puts every label and its cells in one shared label/cells grid, no fixed width', () => {
        const w = mount(CoverageStrip, {
            props: { groups: [{ label: 'BOSS', rows: [row(1), row(2, false)] }, { label: '自身', rows: [row(516)] }] },
        });
        const strips = w.findAll('.strip');
        expect(strips).toHaveLength(2);
        for (const s of strips) {
            expect(s.element.children[0].classList.contains('label')).toBe(true);
            expect(s.element.children[1].classList.contains('cells')).toBe(true);
            expect((s.element.children[0] as HTMLElement).getAttribute('style') ?? '').not.toContain('width');
        }
        expect(w.find('.coverage').element.contains(strips[1].element)).toBe(true);
    });

    it('centres one label and ＋ on all of a group rows', () => {
        const groups = [{ key: 'boss' as const, label: 'BOSS', rows: [row(1), row(2, false)] }, { key: 'self' as const, label: '自身', rows: [row(516)] }];
        const w = mount(CoverageStrip, { props: { groups } });
        const [boss, self] = w.findAll('.strip');
        expect(boss.findAll('.label')).toHaveLength(1);
        expect(boss.findAll('.cells')).toHaveLength(2);
        expect(boss.get('.label').attributes('style')).toContain('grid-row: span 2');
        expect(self.get('.label').attributes('style')).toContain('grid-row: span 1');
        expect(w.findAll('[data-strip-plus]')).toHaveLength(2);
    });

    it('draws a dashed divider above the strip rows', () => {
        const w = mount(CoverageStrip, { props: { groups: [{ label: 'BOSS', rows: [row(1)] }] } });
        const div = w.find('.coverage > .divider');
        expect(div.exists()).toBe(true);
        expect(div.element.outerHTML).toContain('divider');
        const rule = source.match(/\.divider \{([^}]*)\}/)![1];
        expect(rule).toMatch(/border-top:\s*1px dashed var\(--c-line\)/);
        expect(rule).not.toContain('gradient');
    });

    it('marks the open strip ＋ as expanded', () => {
        const groups = [{ key: 'boss' as const, label: 'BOSS', rows: [row(1)] }, { key: 'self' as const, label: '自身', rows: [row(2)] }];
        const w = mount(CoverageStrip, { props: { groups, openGroup: 'self' } });
        expect(w.get('[data-strip-plus="boss"]').attributes('aria-expanded')).toBe('false');
        expect(w.get('[data-strip-plus="self"]').attributes('aria-expanded')).toBe('true');
    });

    it('lays the label column on the timeline gutter: icons start at the lane icon x', () => {
        const w = mount(CoverageStrip, { props: { groups: [{ label: 'BOSS', rows: [row(1)] }] } });
        const st = (w.find('.coverage').element as HTMLElement).getAttribute('style') ?? '';
        expect(st).toContain(`--icon-left: ${ICON_LEFT}px`);
        expect(st).toContain(`--label-x: ${GROUP_LABEL_X}px`);
        expect(st).toContain(`--label-px: ${GROUP_LABEL_FONT}px`);
    });

    it('colours the self label with the accent like the timeline', () => {
        const w = mount(CoverageStrip, { props: { groups: [{ label: '自身', accent: true, rows: [row(1)] }] } });
        expect(w.find('.label').classes()).toContain('accent');
    });

    it('renders labels without writing-mode: Latin rotated, CJK one char per element', async () => {
        const w = mount(CoverageStrip, { props: { groups: [{ label: 'BOSS', rows: [row(1)] }, { label: '自身', rows: [row(2)] }] } });
        const labels = w.findAll('.label');
        expect(labels[0].find('.glyphs').classes()).toContain('rot');
        expect(labels[0].text()).toBe('BOSS');
        expect(labels[1].find('.glyphs').classes()).not.toContain('rot');
        expect(labels[1].findAll('.ch').map(c => c.text())).toEqual(['自', '身']);
        const src = (await import('./CoverageStrip.vue?raw')).default as string;
        expect(src).not.toMatch(/writing-mode\s*:/);
        expect(src).toContain('rotate(-90deg)');
    });

    it('puts one screenshot-ignored ＋ in each group label and emits plus with the group key', async () => {
        const w = mount(CoverageStrip, {
            props: { groups: [{ key: 'boss', label: 'BOSS', rows: [row(1), row(2, false)] }, { key: 'self', label: '自身', rows: [row(3, false)] }] },
        });
        const btns = w.findAll('button[data-strip-plus]');
        expect(btns.map(b => b.attributes('data-strip-plus'))).toEqual(['boss', 'self']);
        expect(btns[0].attributes('data-html2canvas-ignore')).toBeDefined();
        expect(w.findAll('.strip')[0].findAll('button')).toHaveLength(1);
        // A group with only off-chart rows still carries its label.
        expect(w.findAll('.strip')[1].find('.glyphs').text()).toBe('自身');
        await btns[1].trigger('click');
        expect(w.emitted('plus')![0][0]).toBe('self');
        expect(w.emitted('plus')![0][1]).toBeInstanceOf(MouseEvent);
    });
});

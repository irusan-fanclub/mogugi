// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import { dpsTimelineOption, TIMELINE_TOKENS } from './dpsTimelineOption';
// Importing EChart.vue runs its echarts.use([...]) against the real echarts.
import './EChart.vue';

// happy-dom has no canvas, so the test chart renders to SVG strings (ssr); components are what is under test.
echarts.use([SVGRenderer]);

describe('EChart component registration', () => {
    it('keeps the graphic, markLine and markArea parts of the timeline option', () => {
        const tokens = Object.fromEntries(TIMELINE_TOKENS.map(n => [n, '#888']));
        const lane = { ccId: 1, name: 'a', icon: '', points: [[0, 1]] as [number, 0 | 1][], ticks: [100] };
        const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 600, height: 300 });
        chart.setOption(dpsTimelineOption({
            entities: [{ name: 'A', points: [[0, 1]] }], lanes: [lane], selfLanes: [lane], selfTitle: 'x',
            invincible: [[1000, 3000]], maxMs: 9000, tokens,
        }), { notMerge: true });
        const model = (chart as unknown as { getModel(): { getComponent(t: string): unknown } }).getModel();
        // An unregistered component type is dropped from the model, so these are undefined without use().
        expect(model.getComponent('graphic')).toBeTruthy();
        expect(model.getComponent('markArea')).toBeTruthy();
        expect(model.getComponent('markLine')).toBeTruthy();
        chart.dispose();
    });

    it('renders the HP ruler custom series', () => {
        const tokens = Object.fromEntries(TIMELINE_TOKENS.map(n => [n, '#888']));
        const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 600, height: 300 });
        chart.setOption(dpsTimelineOption({
            entities: [{ name: 'A', points: [[0, 1], [9000, 2]] }], lanes: [], selfLanes: [], selfTitle: '',
            invincible: [], maxMs: 9000, tokens,
            ruler: { marks: [{ pct: 50, at: 4 }], originSec: 0 }, hpAt: () => 50,
        }), { notMerge: true });
        expect(chart.renderToSVGString()).toContain('>50</text>');
        chart.dispose();
    });
});

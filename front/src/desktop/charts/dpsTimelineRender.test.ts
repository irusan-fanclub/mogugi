// Real ECharts (SSR), so the zoom path is exercised rather than the option object.
import { it, expect } from 'vitest';
import * as echarts from 'echarts';
import { dpsTimelineOption, TIMELINE_TOKENS } from './dpsTimelineOption';

it('a zoom leaves no ruler label outside the view', () => {
    const tokens = Object.fromEntries(TIMELINE_TOKENS.map(n => [n, '#888']));
    const marks = [95, 90, 75, 50, 25, 5].map((pct, i) => ({ pct, at: 100 + i * 100 }));
    const o = dpsTimelineOption({
        entities: [{ name: 'A', points: [[0, 1], [600000, 2]] }], lanes: [], selfLanes: [], selfTitle: '',
        invincible: [[100000, 150000], [550000, 560000]], maxMs: 600000, tokens, ruler: { marks, originSec: 100, guideStep: 25 },
    });
    const c = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 800, height: 400 });
    c.setOption(o as never);
    c.dispatchAction({ type: 'dataZoom', startValue: 80000, endValue: 300000 });
    const shown = [...c.renderToSVGString().matchAll(/<text[^>]*>(\d+)<\/text>/g)].map(m => m[1]).filter(t => ['95', '90', '75', '50', '25', '5'].includes(t));
    expect(shown).toEqual(['90', '75', '50']);
    c.dispose();
});

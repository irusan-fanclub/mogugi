import { describe, it, expect } from 'vitest';
import { dpsTimelineOption, dpsTimelineHeight, fmtAxisCompact, plusTops, PLUS_H, TIMELINE_TOKENS, type TimelineInput } from './dpsTimelineOption';

const tokens: Record<string, string> = Object.fromEntries(TIMELINE_TOKENS.map(n => [n, `tok${n}`]));
const pts = (n: number): [number, number][] => Array.from({ length: n }, (_, i) => [i * 1000, i]);

function input(over: Partial<TimelineInput> = {}): TimelineInput {
    return {
        entities: [{ name: 'A', points: pts(10) }, { name: 'B', points: pts(10) }],
        partyPoints: pts(10).map(([x, y]) => [x, y * 2] as [number, number]),
        lanes: [1, 2, 3].map(id => ({ ccId: id, name: `cc${id}`, icon: `/icons/cc/${id}.png`, points: [[0, 0], [1000, 1], [2000, 0]] as [number, 0 | 1][], ticks: [] })),
        selfLanes: [],
        selfTitle: '',
        invincible: [],
        maxMs: 9000,
        tokens,
        ...over,
    };
}
const arr = <T,>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

describe('dpsTimelineOption', () => {
    it('builds one grid for the DPS plot plus one per lane, all wired together', () => {
        const o = dpsTimelineOption(input());
        expect(arr(o.grid)).toHaveLength(4);
        expect(arr(o.series)).toHaveLength(6);
        const xs = arr(o.xAxis) as { gridIndex: number }[];
        const ys = arr(o.yAxis) as { gridIndex: number }[];
        expect(xs.map(x => x.gridIndex)).toEqual([0, 1, 2, 3]);
        expect(ys.map(y => y.gridIndex)).toEqual([0, 1, 2, 3]);
        const link = (arr(o.axisPointer)[0] as { link: { xAxisIndex: number[] }[] }).link;
        expect(link[0].xAxisIndex).toEqual([0, 1, 2, 3]);
    });

    it('puts lane icons right next to the plot left edge, derived from the grid left', () => {
        const o = dpsTimelineOption(input());
        const left = (arr(o.grid)[1] as { left: number }).left;
        const y = arr(o.yAxis)[1] as { nameGap: number; nameTextStyle: { align: string } };
        // ECharts right-aligns the name at gridLeft - nameGap, so that is the icon's right edge.
        expect(y.nameTextStyle.align).toBe('right');
        expect(y.nameGap).toBeGreaterThan(0);
        expect(left - (left - y.nameGap)).toBeLessThanOrEqual(6);
    });

    it('sizes the DPS grid 190px and lanes 16px, laid out top to bottom', () => {
        const g = arr(dpsTimelineOption(input()).grid) as { top: number; height: number }[];
        expect(g[0].height).toBe(190);
        expect(g.slice(1).every(x => x.height === 16)).toBe(true);
        // Lanes sit edge to edge under the x-axis labels.
        expect(g[1].top).toBeGreaterThan(g[0].top + 190);
        for (let i = 2; i < g.length; i++) expect(g[i].top).toBe(g[i - 1].top + 16);
        expect(dpsTimelineHeight(3)).toBeGreaterThan(g[3].top + 16);
    });

    it('draws lanes as step areas that hold the state forward, on their own axes', () => {
        const s = arr(dpsTimelineOption(input()).series) as { type: string; step?: string; areaStyle?: unknown; xAxisIndex: number; yAxisIndex: number }[];
        expect(s[0].type).toBe('line');
        expect(s[4].xAxisIndex).toBe(2);
        expect(s[4].yAxisIndex).toBe(2);
        expect(s[4].step).toBe('end');
        expect(s[4].areaStyle).toBeTruthy();
    });

    it('caps every series at 800 points', () => {
        const o = dpsTimelineOption(input({ entities: [{ name: 'A', points: pts(5000) }], maxMs: 4999000 }));
        for (const s of arr(o.series) as { data: unknown[] }[]) expect(s.data.length).toBeLessThanOrEqual(800);
    });

    it('formats the x axis as m:ss, titles it and zooms every x axis', () => {
        const o = dpsTimelineOption(input());
        const x0 = arr(o.xAxis)[0] as { axisLabel: { formatter: (v: number) => string }; max: number };
        expect(x0.axisLabel.formatter(75000)).toBe('1:15');
        expect(x0.max).toBe(9000);
        expect((o.title as { text: string }).text).toBe('DPS（每 15 秒）與狀態時間軸');
        const dz = arr(o.dataZoom) as { type: string; xAxisIndex: number[] }[];
        expect(dz.filter(d => d.type === 'inside')[0].xAxisIndex).toEqual([0, 1, 2, 3]);
    });

    it('works with no lanes and takes colors from tokens', () => {
        const o = dpsTimelineOption(input({ lanes: [] }));
        expect(arr(o.grid)).toHaveLength(1);
        expect(JSON.stringify(o)).not.toContain('#');
        expect((arr(o.series)[0] as { lineStyle: { color: string } }).lineStyle.color).toBe('tok--c-series-1');
    });

    it('keeps every grid at the same left edge regardless of label width', () => {
        // ECharts 6 shrinks a grid whose labels overflow unless outerBoundsMode is 'none'.
        const g = arr(dpsTimelineOption(input()).grid) as { left: number; outerBoundsMode?: string }[];
        expect(new Set(g.map(x => x.left)).size).toBe(1);
        expect(g.every(x => x.outerBoundsMode === 'none')).toBe(true);
    });

    it('aligns the time axis edge labels inward so the last one is not clipped', () => {
        const x0 = arr(dpsTimelineOption(input()).xAxis)[0] as { axisLabel: { alignMinLabel: string; alignMaxLabel: string } };
        expect([x0.axisLabel.alignMinLabel, x0.axisLabel.alignMaxLabel]).toEqual(['left', 'right']);
    });

    it('zooms on Ctrl+wheel only, so a plain wheel scrolls the page', () => {
        const dz = arr(dpsTimelineOption(input()).dataZoom)[0] as { zoomOnMouseWheel: unknown; moveOnMouseWheel: unknown };
        expect([dz.zoomOnMouseWheel, dz.moveOnMouseWheel]).toEqual(['ctrl', false]);
    });

    it('labels the DPS y axis with K and M', () => {
        const y0 = arr(dpsTimelineOption(input()).yAxis)[0] as { axisLabel: { formatter: (v: number) => string } };
        expect(y0.axisLabel.formatter).toBe(fmtAxisCompact);
        expect([0, 500, 1000, 1500, 200000, 1000000, 1500000, 12000000, 2500000000].map(fmtAxisCompact))
            .toEqual(['0', '500', '1K', '1.5K', '200K', '1M', '1.5M', '12M', '2500M']);
    });

    describe('self lanes, ticks and invincible boxes', () => {
        const mk = (id: number, ticks: number[] = []) => ({ ccId: id, name: `cc${id}`, icon: `/i/${id}.png`, points: [[0, 1]] as [number, 0 | 1][], ticks });
        const full = () => dpsTimelineOption(input({
            lanes: [mk(1, [100, 200]), mk(2)], selfLanes: [mk(9, [500, 600, 700])],
            selfTitle: '自身', invincible: [[1000, 3000], [5000, 6000]],
        }));
        type Mark = { data: unknown[] };
        type S = { id: string; markLine?: Mark; markArea?: Mark };

        it('adds the self lane and the overlay grid', () => {
            expect(arr(full().grid)).toHaveLength(5);
            expect(arr(full().xAxis)).toHaveLength(5);
        });

        it('puts the first self lane right under the last boss lane, with no divider', () => {
            const o = full();
            const g = arr(o.grid) as { top: number }[];
            expect(g[3].top).toBe(g[2].top + 16);
            expect((arr(o.graphic) as { type: string }[]).some(x => x.type === 'line')).toBe(false);
        });

        it('labels both groups left of the icons, centred on their lanes', () => {
            const o = full();
            const g = arr(o.grid) as { top: number; height: number }[];
            const gr = arr(o.graphic) as { type: string; x?: number; y?: number; style: { text?: string } }[];
            const label = (text: string) => gr.find(e => e.type === 'text' && e.style.text === text)!;
            expect(label('BOSS').y).toBe((g[1].top + g[2].top + g[2].height) / 2);
            expect(label('自\n身').y).toBe(g[3].top + g[3].height / 2);
            // Icon column left edge = LEFT(50) - nameGap(4) - icon(16) = 30; labels hug it.
            for (const t of ['BOSS', '自\n身']) {
                expect(label(t).x).toBeLessThan(30);
                expect(label(t).x).toBeGreaterThanOrEqual(30 - 14);
            }
        });

        it('labels BOSS without self lanes, and the reserved 自身 row when its ＋ is shown', () => {
            const texts = (o: ReturnType<typeof dpsTimelineOption>) =>
                (arr(o.graphic) as { type: string; style: { text?: string } }[]).filter(e => e.type === 'text').map(e => e.style.text);
            expect(texts(dpsTimelineOption(input()))).toEqual(['BOSS']);
            expect(texts(dpsTimelineOption(input({ selfTitle: '自身', reserveSelfRow: true })))).toEqual(['BOSS', '自\n身']);
        });

        it('labels 自身 in the reserved row with no lanes at all, and nothing when no ＋ shows', () => {
            const texts = (o: ReturnType<typeof dpsTimelineOption>) =>
                (arr(o.graphic) as { type: string; style: { text?: string } }[]).filter(e => e.type === 'text').map(e => e.style.text);
            expect(texts(dpsTimelineOption(input({ lanes: [], selfTitle: '自身', reserveSelfRow: true })))).toEqual(['自\n身']);
            expect(arr(dpsTimelineOption(input({ lanes: [] })).graphic)).toHaveLength(0);
        });

        it('draws one markLine entry per tick on each lane', () => {
            const s = arr(full().series) as S[];
            expect(s.find(x => x.id === 'lane:1')!.markLine!.data).toHaveLength(2);
            expect(s.find(x => x.id === 'lane:2')!.markLine!.data).toHaveLength(0);
            expect(s.find(x => x.id === 'lane:self:9')!.markLine!.data).toHaveLength(3);
        });

        it('tints each invincible span, named 無敵 with a legend item shown by default', () => {
            const o = full();
            const s = (arr(o.series) as (S & { name?: string })[]).find(x => x.id === 'invincible')!;
            expect(s.markArea!.data).toEqual([[{ xAxis: 1000 }, { xAxis: 3000 }], [{ xAxis: 5000 }, { xAxis: 6000 }]]);
            expect(s.name).toBe('無敵');
            const legend = o.legend as { data: (string | { name: string })[]; selected: Record<string, boolean> };
            expect(legend.data.map(d => (typeof d === 'string' ? d : d.name)).at(-1)).toBe('無敵');
            expect(legend.selected['無敵']).toBe(true);
        });

        it('zooms every x axis but links all except the overlay', () => {
            const o = full();
            const n = arr(o.xAxis).length;
            const link = (arr(o.axisPointer)[0] as { link: { xAxisIndex: number[] }[] }).link[0].xAxisIndex;
            const dz = (arr(o.dataZoom) as { xAxisIndex: number[] }[])[0].xAxisIndex;
            expect(dz).toEqual(Array.from({ length: n }, (_, i) => i));
            expect(link).toEqual(Array.from({ length: n - 1 }, (_, i) => i));
        });

        it('keeps outerBoundsMode none on the overlay grid', () => {
            expect((arr(full().grid) as { outerBoundsMode?: string }[]).every(g => g.outerBoundsMode === 'none')).toBe(true);
        });

        it('adds no overlay grid without invincible spans', () => {
            expect(arr(dpsTimelineOption(input()).grid)).toHaveLength(4);
        });

        it('keeps helper series out of the tooltip rows', () => {
            const f = (full().tooltip as { formatter: (p: unknown) => string }).formatter;
            const out = f([
                { seriesId: 'invincible', seriesName: '', marker: 'M', value: [0, 0], axisValue: 0 },
                { seriesId: 'lane:self:9', seriesName: 'cc9', marker: 'M', value: [0, 1], axisValue: 0 },
            ]);
            expect(out).toContain('cc9');
            expect(out.split('<br/>')).toHaveLength(2);
        });

        it('returns nothing when only the invincible overlay is hovered', () => {
            const f = (full().tooltip as { formatter: (p: unknown) => string }).formatter;
            expect(f([{ seriesId: 'invincible', seriesName: '', marker: 'M', value: [0, 0], axisValue: 0 }])).toBe('');
        });

        it('sizes the height with the self band', () => {
            expect(dpsTimelineHeight(2, 0)).toBe(dpsTimelineHeight(2));
            expect(dpsTimelineHeight(2, 1)).toBe(dpsTimelineHeight(2, 0) + 16);
        });
    });
});

describe('dpsTimelineOption lane tooltip', () => {
    it('reads a lane state at the hovered time, not from the nearest point', () => {
        const lanes = [{ ccId: 1, name: 'cc1', icon: '', points: [[0, 0], [1000, 1], [5000, 0]] as [number, 0 | 1][], ticks: [] }];
        const f = (dpsTimelineOption(input({ lanes })).tooltip as { formatter: (p: unknown) => string }).formatter;
        const at = (ms: number, nearest: [number, number]) =>
            f([{ seriesId: 'lane:1', seriesName: 'cc1', marker: '', value: nearest, axisValue: ms }]);
        expect(at(4000, [5000, 0])).not.toContain('未啟用');
        expect(at(6000, [5000, 0])).toContain('未啟用');
        expect(at(500, [1000, 1])).toContain('未啟用');
    });
});

describe('dpsTimelineOption lane colours', () => {
    it('colours a lane by its colorIndex, so a CC keeps its colour when other lanes come and go', () => {
        const colours = (o: ReturnType<typeof dpsTimelineOption>) => (arr(o.series) as { id?: string; itemStyle?: { color: string } }[])
            .filter(x => x.id?.startsWith('lane:')).map(x => x.itemStyle!.color);
        const lanes = input().lanes.map((l, i) => ({ ...l, colorIndex: i + 1 }));
        // (index * 7) mod 16 + 1
        expect(colours(dpsTimelineOption(input({ lanes })))).toEqual(['tok--c-lane-8', 'tok--c-lane-15', 'tok--c-lane-6']);
        expect(colours(dpsTimelineOption(input({ lanes: lanes.slice(1) })))).toEqual(['tok--c-lane-15', 'tok--c-lane-6']);
        const all16 = Array.from({ length: 16 }, (_, i) => ({ ...lanes[0], ccId: 100 + i, colorIndex: i }));
        expect(new Set(colours(dpsTimelineOption(input({ lanes: all16 })))).size).toBe(16);
    });
});

describe('dpsTimelineOption hp ruler', () => {
    const ruler = {
        marks: [{ pct: 75, at: 10 }, { pct: 70, at: 20 }, { pct: 50, at: 30 }, { pct: 25, at: 40 }],
        originSec: 0,
    };
    const hpAt = (ms: number) => 100 - ms / 1000;
    type Ser = { id?: string; xAxisIndex?: number; markLine?: { data: { xAxis: number }[] } };
    const guides = (o: ReturnType<typeof dpsTimelineOption>) => (arr(o.series) as Ser[]).find(x => x.id === 'hpRulerLines');
    it('draws guides only at 25/50/75 by default and adds the band series', () => {
        const o = dpsTimelineOption(input({ ruler }));
        const s = arr(o.series) as Ser[];
        expect(s.some(x => x.id === 'hpRuler')).toBe(true);
        expect(guides(o)!.markLine!.data.map(d => d.xAxis)).toEqual([10000, 30000, 40000]);
        expect(s.filter(x => x.id?.startsWith('hpRuler'))).toHaveLength(2);
    });
    it('runs the guides on a full-height grid through the BOSS and 自身 lanes', () => {
        const self = [{ ccId: 9, name: 's', icon: '', points: [[0, 1]] as [number, 0 | 1][], ticks: [] }];
        const o = dpsTimelineOption(input({ ruler, selfLanes: self }));
        const grids = arr(o.grid) as { top: number; height: number }[];
        const g = grids[guides(o)!.xAxisIndex!];
        const lastLane = grids[4];
        expect(g.top).toBe(grids[0].top);
        expect(g.top + g.height).toBe(lastLane.top + lastLane.height);
        const zoom = arr(o.dataZoom)[0] as { xAxisIndex: number[] };
        expect(zoom.xAxisIndex).toContain(guides(o)!.xAxisIndex);
    });
    it('band false drops the ruler band but keeps the guides', () => {
        const s = arr(dpsTimelineOption(input({ ruler: { ...ruler, band: false } })).series) as Ser[];
        expect(s.some(x => x.id === 'hpRuler')).toBe(false);
        expect(s.some(x => x.id === 'hpRulerLines')).toBe(true);
    });
    it('shrinks a group label to fit a one-lane group', () => {
        const self = [{ ccId: 9, name: 's', icon: '', points: [[0, 1]] as [number, 0 | 1][], ticks: [] }];
        const g = arr(dpsTimelineOption(input({ selfLanes: self, selfTitle: '自身' })).graphic) as { style?: { text: string; fontSize: number } }[];
        const size = (t: string) => g.find(x => x.style?.text === t)!.style!.fontSize;
        expect(size('BOSS')).toBe(9);
        expect(size('自\n身')).toBe(8);
    });
    it('rules the top of every lane, ticks the first, and fills each lane edge to edge', () => {
        const o = dpsTimelineOption(input());
        const xs = arr(o.xAxis) as { position?: string; axisLine: { show: boolean }; axisTick: { show: boolean }; splitLine: { show: boolean } }[];
        expect(xs.slice(1, 4).map(x => [x.position, x.axisLine.show, x.axisTick.show])).toEqual([['top', true, true], ['top', true, false], ['top', true, false]]);
        expect(xs.every(x => !x.splitLine.show)).toBe(true);
        expect((xs[1] as { z?: number }).z).toBeGreaterThan(2);
        const tick = (arr(o.series) as { id?: string; markLine?: { z: number } }[]).find(s => s.id === 'lane:1')!.markLine!;
        expect(tick.z).toBeLessThan((xs[1] as unknown as { z: number }).z);
        const ys = arr(o.yAxis) as { min: number; max: number }[];
        expect(ys.slice(1, 4).map(y => [y.min, y.max])).toEqual([[0, 1], [0, 1], [0, 1]]);
    });
    it('guideStep picks the guide interval; 0 draws none', () => {
        expect(guides(dpsTimelineOption(input({ ruler: { ...ruler, guideStep: 10 } })))!.markLine!.data.map(d => d.xAxis))
            .toEqual([20000, 30000]);
        const off = dpsTimelineOption(input({ ruler: { ...ruler, guideStep: 0 } }));
        expect(guides(off)).toBeUndefined();
        expect(arr(off.grid)).toHaveLength(4);
    });
    it('adds no ruler series without marks', () => {
        const o = dpsTimelineOption(input());
        expect((arr(o.series) as { id?: string }[]).some(x => x.id?.startsWith('hpRuler'))).toBe(false);
    });
    it('adds the boss HP line to the tooltip', () => {
        const o = dpsTimelineOption(input({ ruler, hpAt }));
        const f = (o.tooltip as { formatter: (p: unknown) => string }).formatter;
        const html = f([{ seriesId: 'dps:0', seriesName: 'A', marker: '', value: [2000, 5], axisValue: 2000 }]);
        expect(html).toContain('BOSS 血量 98.0%');
    });
});

describe('dpsTimelineOption party total and tooltip header', () => {
    type Ser = { id?: string; name?: string; lineStyle?: { type?: unknown; width?: number; color?: string }; data?: [number, number][] };
    const hpAt = () => 42;
    const fmt = (o: ReturnType<typeof dpsTimelineOption>) => (o.tooltip as { formatter: (p: unknown) => string }).formatter;

    it('adds a thin dashed 隊伍總和 line summing the players, off by default', () => {
        const o = dpsTimelineOption(input());
        const s = (arr(o.series) as Ser[]).find(x => x.name === '隊伍總和')!;
        expect(s.lineStyle!.type).toBe('dashed');
        expect(s.lineStyle!.width).toBeLessThanOrEqual(1);
        expect(s.lineStyle!.color).toBe(tokens['--c-text-dim']);
        expect(s.data![3]).toEqual([3000, 6]);
        expect(s.data).toEqual(input().partyPoints);
        const lg = arr(o.legend)[0] as { data: string[]; selected: Record<string, boolean> };
        expect(lg.data).toContain('隊伍總和');
        expect(lg.selected['隊伍總和']).toBe(false);
    });

    it('feeds the remembered legend selection back', () => {
        const o = dpsTimelineOption(input({ legendSelected: { 隊伍總和: true, A: false } }));
        const lg = arr(o.legend)[0] as { selected: Record<string, boolean> };
        expect(lg.selected['隊伍總和']).toBe(true);
        expect(lg.selected.A).toBe(false);
        expect(lg.selected.B).toBeUndefined();
    });

    it('puts bold time then bold BOSS HP before the player rows', () => {
        const html = fmt(dpsTimelineOption(input({ hpAt })))([
            { seriesId: 'dps:0', seriesName: 'A', marker: '', value: [2000, 5], axisValue: 2000 },
        ]);
        const lines = html.split('<br/>');
        expect(lines[0]).toBe('<b>0:02</b>');
        expect(lines[1]).toBe('<b>BOSS 血量 42.0%</b>');
        expect(lines[2]).toContain('A');
    });

    it('omits the HP line without HP data', () => {
        const lines = fmt(dpsTimelineOption(input()))([
            { seriesId: 'dps:0', seriesName: 'A', marker: '', value: [2000, 5], axisValue: 2000 },
        ]).split('<br/>');
        expect(lines[0]).toBe('<b>0:02</b>');
        expect(lines[1]).toContain('A');
        expect(lines).toHaveLength(2);
    });

    it('lists the party total in the tooltip when it is visible', () => {
        const html = fmt(dpsTimelineOption(input()))([
            { seriesId: 'party', seriesName: '隊伍總和', marker: '', value: [2000, 9], axisValue: 2000 },
        ]);
        expect(html).toContain('隊伍總和');
    });

    it('omits the party series and legend entry without players', () => {
        const o = dpsTimelineOption(input({ entities: [] }));
        expect((arr(o.series) as Ser[]).some(x => x.id === 'party')).toBe(false);
        expect((arr(o.legend)[0] as { data: string[] }).data).not.toContain('隊伍總和');
    });

    it('keeps the time and HP header when no series rows are listed', () => {
        const html = fmt(dpsTimelineOption(input({ hpAt })))([
            { seriesId: 'invincible', seriesName: '', marker: '', value: [2000, 0], axisValue: 2000 },
        ]);
        expect(html.split('<br/>')).toEqual(['<b>0:02</b>', '<b>BOSS 血量 42.0%</b>']);
    });

    it('puts the party series right after the player series', () => {
        const ids = (arr(dpsTimelineOption(input()).series) as Ser[]).map(x => x.id);
        expect(ids.slice(0, 3)).toEqual(['dps:0', 'dps:1', 'party']);
        expect(ids[3]).toMatch(/^lane:/);
    });

    it('centres each group ＋ on its lanes, at the same y as the group label', () => {
        const o = dpsTimelineOption(input({ selfLanes: [9, 8].map(id => ({ ccId: id, name: `s${id}`, icon: '', points: [[0, 1]] as [number, 0 | 1][], ticks: [] })), selfTitle: '自身' }));
        const ys = (arr(o.graphic) as { type: string; y: number }[]).filter(g => g.type === 'text').map(g => g.y);
        const tops = plusTops(3, 2);
        expect(tops.boss + PLUS_H / 2).toBeCloseTo(ys[0]);
        expect(tops.self + PLUS_H / 2).toBeCloseTo(ys[1]);
    });
});

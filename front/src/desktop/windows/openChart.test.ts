// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';

const env = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/lib/runtimeEnv', () => ({ isDesktop: () => env.desktop }));
const emit = vi.fn(async () => {});
vi.mock('@/lib/desktopBridge', () => ({ emitDesktop: (...a: unknown[]) => emit(...(a as [])) }));

import { chartId, openChart } from './openChart';
import { chartHubId } from '@/lib/chartTransport';
import type { ChartSpec } from '@/lib/chartProtocol';

const ID_RE = /^[a-z0-9-]{1,40}$/;

beforeEach(() => { emit.mockClear(); env.desktop = true; });

describe('openChart', () => {
    it('ids are valid and stable for equal specs', () => {
        const specs: ChartSpec[] = [
            { kind: 'condition', attackerId: '4503599630022047' },
            { kind: 'hitlog', attackerId: '4503599630022047', targetId: '', skillId: 1 },
        ];
        const ids = specs.map(chartId);
        for (const id of ids) expect(id).toMatch(ID_RE);
        expect(new Set(ids).size).toBe(specs.length);
        expect(chartId({ ...specs[1] })).toBe(ids[1]);
    });

    it('a different skill or target gives a different id', () => {
        const a = chartId({ kind: 'hitlog', attackerId: 'x', targetId: 't1' });
        const b = chartId({ kind: 'hitlog', attackerId: 'x', targetId: 't2' });
        expect(a).not.toBe(b);
    });

    it('sends window:open with a JSON spec', () => {
        const spec: ChartSpec = { kind: 'hitlog', attackerId: 'p1', targetId: '', skillId: 7 };
        openChart(spec, 'p1 -> All');
        expect(emit).toHaveBeenCalledTimes(1);
        expect(emit).toHaveBeenCalledWith('window:open', {
            id: chartId(spec), kind: 'hitlog', title: 'p1 -> All', spec: JSON.stringify(spec),
        });
    });

    it('opens a browser tab with the same parameters outside the desktop', () => {
        env.desktop = false;
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        const spec: ChartSpec = { kind: 'hitlog', attackerId: 'p1', targetId: '', skillId: 7 };
        openChart(spec, 'p1 -> All');
        expect(emit).not.toHaveBeenCalled();
        expect(open).toHaveBeenCalledTimes(1);
        const [url, target] = open.mock.calls[0] as [string, string];
        expect(target).toBe(chartId(spec));
        expect(url.startsWith('/chart.html?')).toBe(true);
        const q = new URLSearchParams(url.split('?')[1]);
        expect(q.get('id')).toBe(chartId(spec));
        expect(q.get('kind')).toBe('hitlog');
        expect(q.get('title')).toBe('p1 -> All');
        expect(q.get('spec')).toBe(JSON.stringify(spec));
        expect(q.get('hub')).toBe(chartHubId);
        open.mockRestore();
    });
});

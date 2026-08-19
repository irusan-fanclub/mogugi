import { describe, it, expect } from 'vitest';
import { buildBardsongConditionHistory, BARDSONG_CC_ID } from './bardsongTrack';
import { ccName } from './util';
import { eventIdBardsong, type eventBardsong } from '@/protocols';

const start = (At: number): eventBardsong => ({
    EventId: eventIdBardsong, At, Id: '', Performer: '', Song: '戰場上的狂吼', Bonuses: { 最大攻擊力: 35 }, IsEnd: false,
});
const end = (At: number): eventBardsong => ({
    EventId: eventIdBardsong, At, Id: '', Performer: '', Song: '', Bonuses: {}, IsEnd: true,
});

describe('buildBardsongConditionHistory', () => {
    it('turns a start-then-end pair into a present state then an absent one', () => {
        const h = buildBardsongConditionHistory([start(10), end(30)]);
        expect(h).toHaveLength(2);
        expect(h[0]).toEqual({ At: 10, List: [{ Id: '', At: 10, CCId: BARDSONG_CC_ID, DisableAt: 0, AttackerId: '', Params: {} }] });
        expect(h[1]).toEqual({ At: 30, List: [] });
    });

    it('leaves an unfinished start as a single present state', () => {
        const h = buildBardsongConditionHistory([start(10)]);
        expect(h).toHaveLength(1);
        expect(h[0].List).toHaveLength(1);
    });

    it('produces nothing for an end with no matching start', () => {
        expect(buildBardsongConditionHistory([end(30)])).toEqual([]);
    });

    it('collapses an overlapping start/end run into one present and one absent state, At pinned to the first start', () => {
        const h = buildBardsongConditionHistory([start(10), start(20), end(30), end(40)]);
        expect(h).toHaveLength(2);
        expect(h[0].At).toBe(10);
        expect(h[0].List[0].At).toBe(10);
        expect(h[1]).toEqual({ At: 40, List: [] });
    });

    // Without Math.max(0, ...) this orphan end would leave depth at -1, so the
    // following start would need two ends to close it instead of one.
    it('does not let a stray unmatched end poison a later start (depth floor)', () => {
        const h = buildBardsongConditionHistory([end(10), start(20)]);
        expect(h).toHaveLength(1);
        expect(h[0]).toEqual({ At: 20, List: [{ Id: '', At: 20, CCId: BARDSONG_CC_ID, DisableAt: 0, AttackerId: '', Params: {} }] });
    });

    // Pins the synthetic id: changing it silently breaks hiddenTrackIds
    // persistence and PLAYER_SIDE_CC_IDS wiring in dpsDebuffChart.vue, and
    // nothing else would catch the drift.
    it('pins BARDSONG_CC_ID', () => {
        expect(BARDSONG_CC_ID).toBe(900206);
    });
});

describe('BARDSONG_CC_ID cross-file sync', () => {
    // build-data.mjs runs main() at module scope on import, so it cannot be
    // imported here — Vite's raw-text glob (typed via vite/client, no Node
    // fs/@types/node needed) reads its source for a plain string match instead.
    const buildDataSrc = import.meta.glob('../../scripts/build-data.mjs', {
        eager: true, query: '?raw', import: 'default',
    }) as Record<string, string>;

    it('keeps build-data.mjs and util.ts pointed at the same id', () => {
        const script = Object.values(buildDataSrc)[0];
        expect(script).toContain(`ccId: ${BARDSONG_CC_ID}`);
        expect(ccName({}, BARDSONG_CC_ID)).toBe('戰吼');
    });
});

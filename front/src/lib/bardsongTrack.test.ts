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

    it('produces nothing for an end with no matching start', () => {
        expect(buildBardsongConditionHistory([end(30)])).toEqual([]);
    });

    // The game re-announces on every re-shout but sends ONE end when the
    // effect finally lapses, and the server sometimes double-sends a start —
    // depth counting got permanently stuck present (coverage 100%). The
    // buff is a single non-stacking state: start = on/refresh, end = off.
    it('treats repeated starts as refreshes closed by a single end', () => {
        const h = buildBardsongConditionHistory([start(10), start(20), start(20), end(40)]);
        expect(h).toHaveLength(2);
        expect(h[0].At).toBe(10);
        expect(h[1]).toEqual({ At: 40, List: [] });
    });

    it('ignores a second end after the state already closed', () => {
        const h = buildBardsongConditionHistory([start(10), end(30), end(40)]);
        expect(h).toHaveLength(2);
        expect(h[1].At).toBe(30);
    });

    // A start whose end notice never arrives (player dead/out of range when
    // the effect lapsed) must not paint the buff on forever.
    it('auto-expires an orphan start 60s after its last refresh', () => {
        const h = buildBardsongConditionHistory([start(10), start(30), start(500), end(520)]);
        expect(h.map(v => v.At)).toEqual([10, 90, 500, 520]);
        expect(h[1].List).toEqual([]);
    });

    it('auto-expires the tail when the stream ends while present', () => {
        const h = buildBardsongConditionHistory([start(10)]);
        expect(h.map(v => v.At)).toEqual([10, 70]);
        expect(h[1].List).toEqual([]);
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

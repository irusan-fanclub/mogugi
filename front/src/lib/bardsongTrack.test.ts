import { describe, it, expect } from 'vitest';
import { buildBardsongConditionHistory, BARDSONG_CC_ID, BARDSONG_PULSE_SEC } from './bardsongTrack';
import { ccName } from './util';
import { eventIdBardsong, eventIdBardsongPulse, type eventBardsong, type eventBardsongPulse } from '@/protocols';

const start = (At: number): eventBardsong => ({
    EventId: eventIdBardsong, At, Id: '', Performer: '', Song: '戰場上的狂吼', Bonuses: { 最大攻擊力: 35 }, IsEnd: false,
});
const end = (At: number): eventBardsong => ({
    EventId: eventIdBardsong, At, Id: '', Performer: '', Song: '', Bonuses: {}, IsEnd: true,
});

const SINGER = '4503599629764211';
const ME = '4503599630207674';
const pulse = (At: number, Targets: string[]): eventBardsongPulse => ({
    EventId: eventIdBardsongPulse, At, Id: SINGER, Targets, Stop: false,
});
const stop = (At: number): eventBardsongPulse => ({
    EventId: eventIdBardsongPulse, At, Id: SINGER, Targets: [], Stop: true,
});
const on = (At: number) => ({ At, List: [{ Id: '', At, CCId: BARDSONG_CC_ID, DisableAt: 0, AttackerId: '', Params: {} }] });
const off = (At: number) => ({ At, List: [] });

// The performer's 0x9093 kind-21 pulses list who the song actually reached;
// each listing grants 20s. The announcement notice goes to the whole party
// even when the local player was out of range (capture 20260910_164818,
// fight 03:05:40: three performances announced, none reached the player).
describe('buildBardsongConditionHistory with pulses', () => {
    it('turns a pulse listing the owner into 20s of presence', () => {
        const h = buildBardsongConditionHistory([start(100)], [pulse(100, [SINGER, ME])], ME);
        expect(h).toEqual([on(100), off(100 + BARDSONG_PULSE_SEC)]);
    });

    it('ignores an announced performance whose pulses never list the owner', () => {
        const h = buildBardsongConditionHistory(
            [start(100), start(160)],
            [pulse(100, [SINGER]), stop(106), pulse(160, [SINGER]), pulse(170, [SINGER]), stop(176)],
            ME,
        );
        expect(h).toEqual([]);
    });

    it('extends one run across consecutive pulses that list the owner', () => {
        const h = buildBardsongConditionHistory(
            [start(100)], [pulse(100, [ME]), pulse(110, [ME]), pulse(121, [ME])], ME,
        );
        expect(h).toEqual([on(100), off(141)]);
    });

    it('keeps the timer running through a pulse that drops the owner and a stop', () => {
        const h = buildBardsongConditionHistory(
            [start(100)], [pulse(100, [ME]), pulse(110, [SINGER]), stop(115)], ME,
        );
        expect(h).toEqual([on(100), off(120)]);
    });

    it('closes early on an end notice that arrives before the timer', () => {
        const h = buildBardsongConditionHistory([start(100), end(112)], [pulse(100, [ME])], ME);
        expect(h).toEqual([on(100), off(112)]);
    });

    it('treats an end notice in the same second as a fresh pulse as a refresh', () => {
        const h = buildBardsongConditionHistory(
            [start(100), end(120)], [pulse(100, [ME]), pulse(120, [ME])], ME,
        );
        expect(h).toEqual([on(100), off(140)]);
    });

    it('does not reopen on a second announcement while the owner is unlisted', () => {
        const h = buildBardsongConditionHistory(
            [start(100), end(120), start(150)],
            [pulse(100, [ME]), pulse(150, [SINGER])],
            ME,
        );
        expect(h).toEqual([on(100), off(120)]);
    });

    it('falls back to the notice rules when no pulse was recorded (older logs)', () => {
        const h = buildBardsongConditionHistory([start(10), end(30)], [], ME);
        expect(h).toEqual([on(10), off(30)]);
    });

    it('falls back to the notice rules when the owner id is unknown', () => {
        const h = buildBardsongConditionHistory([start(10), end(30)], [pulse(10, [ME])], '');
        expect(h).toEqual([on(10), off(30)]);
    });

    // Real fight (log 20260912_030305, pulses from the matching pcapng):
    // the notice rules painted 03:05:49-03:10:38 on (289s); the pulses show
    // the player was first reached at 03:09:57.
    it('reproduces the 20260912 fight: 162s on, not 410s', () => {
        const T = 1789153540;
        const notices = [
            start(T + 9), start(T + 73), start(T + 122), start(T + 257), start(T + 278), end(T + 298),
            start(T + 413), end(T + 433), start(T + 526), end(T + 546), start(T + 565), end(T + 585),
            start(T + 597), start(T + 597), end(T + 617), start(T + 693), end(T + 734),
        ];
        const P = ['p3', 'p2', SINGER, ME, 'p4', 'p5'];
        const pulses = [
            pulse(T + 9, [SINGER]), stop(T + 15),
            pulse(T + 73, [SINGER]), pulse(T + 83, [SINGER]), stop(T + 92),
            pulse(T + 122, [SINGER]), pulse(T + 132, [SINGER]), pulse(T + 143, [SINGER]), stop(T + 149),
            pulse(T + 257, P), pulse(T + 268, [...P, 'pet']), pulse(T + 278, ['p2', SINGER, ME, 'p5']),
            pulse(T + 288, ['p2', SINGER]), stop(T + 293), stop(T + 382),
            pulse(T + 413, [...P, 'pet']), stop(T + 420),
            pulse(T + 526, ['p3', 'p2', SINGER, ME, 'p5']), stop(T + 530),
            pulse(T + 565, P), stop(T + 571),
            pulse(T + 597, [...P, 'x', 'y', 'z', 'mypet']), stop(T + 597), stop(T + 657),
            pulse(T + 693, [...P, 'pet']), pulse(T + 703, [...P, 'pet']), pulse(T + 714, ['p3', SINGER, ME, 'p4']), stop(T + 717),
        ];
        const h = buildBardsongConditionHistory(notices, pulses, ME);
        expect(h.map(v => [v.At - T, v.List.length > 0])).toEqual([
            [257, true], [298, false], [413, true], [433, false], [526, true], [546, false],
            [565, true], [585, false], [597, true], [617, false], [693, true], [734, false],
        ]);
    });
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
    it('auto-expires an orphan start 5min after its last refresh', () => {
        const h = buildBardsongConditionHistory([start(10), start(15), start(500), end(510)]);
        expect(h.map(v => v.At)).toEqual([10, 315, 500, 510]);
        expect(h[1].List).toEqual([]);
    });

    it('auto-expires the tail when the stream ends while present', () => {
        const h = buildBardsongConditionHistory([start(10)]);
        expect(h.map(v => v.At)).toEqual([10, 310]);
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

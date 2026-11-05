/** 信念值強化: fires when the gauge (stat 198) fills. */
export const TUAIRIM_CC = 428;
/** 信念值 gain buff: present while the gauge rises (in combat). */
export const TUAIRIM_GAIN_CC = 425;
/** Gain per second while TUAIRIM_GAIN_CC is on (client data and captures agree). */
export const TUAIRIM_RATE = 0.1667;
// The server reports every point (~6 s) while rising; a longer silence means it stopped.
const EXTRAPOLATE_MAX_SEC = 10;

export interface TuairimReading { value: number; max: number; at: number }
export interface Gauge { value: number; max: number }

/** The gauge now: the last reading plus the gain since it, capped at max. */
export function gaugeNow(r: TuairimReading, now: number, gaining: boolean): Gauge {
    const max = r.max > 0 ? r.max : 100;
    const dt = gaining ? Math.min(EXTRAPOLATE_MAX_SEC, Math.max(0, now - r.at)) : 0;
    return { value: Math.min(max, Math.max(0, r.value + TUAIRIM_RATE * dt)), max };
}

/** Seconds of combat until the gauge fills. */
export const secondsToFull = (g: Gauge): number => Math.max(0, (g.max - g.value) / TUAIRIM_RATE);

export const gaugePct = (g: Gauge): number => Math.floor(g.value / g.max * 100);

/** m:ss, e.g. 9:59; the estimate counts combat time only. */
export function clockText(sec: number): string {
    const s = Math.ceil(sec);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

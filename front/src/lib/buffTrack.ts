// Shared track-id/scope vocabulary for buff-timeline derivations (used by later tasks too).
import { AWAKENING_CC_ID } from './ccConditionTooltip';
import { BARDSONG_CC_ID } from './bardsongTrack';

/** Whether a track is scoped to the whole party or a single character. */
export type TrackScope = 'party' | 'self';

/** Opaque id for a trackable buff/effect, e.g. 'cc:680' or 'cc:900206'. */
export type TrackId = string;

export const ccTrackId = (ccId: number): TrackId => `cc:${ccId}`;

/** CCs read off the party rather than the target, shown as "someone has it
 *  on". One list feeds both the chart's injected lanes and the settings menu,
 *  so the menu cannot miss a lane the chart draws. */
export const PLAYER_SIDE_CC_IDS: readonly number[] = [AWAKENING_CC_ID, BARDSONG_CC_ID];

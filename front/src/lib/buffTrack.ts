// Shared track-id/scope vocabulary for buff-timeline derivations (used by later tasks too).

/** Whether a track is scoped to the whole party or a single character. */
export type TrackScope = 'party' | 'self';

/** Opaque id for a trackable buff/effect, e.g. 'cc:680' or 'cc:900206'. */
export type TrackId = string;

export const ccTrackId = (ccId: number): TrackId => `cc:${ccId}`;
